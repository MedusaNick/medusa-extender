import { Service } from '../../decorators';
import { Connection, createConnection, EntityManager, getConnectionManager } from 'typeorm';
import { ShortenedNamingStrategy } from '@medusajs/medusa/dist/utils/naming-strategy';
import { ConfigModule } from './types';
import { MedusaRequest } from '../../core';
import { getConfigFile } from 'medusa-core-utils';

@Service()
export class TenantService {
	static readonly resolutionKey = 'tenantService';

	/**
	 * Provide a way to switch between database connections depending on the request property holding the tenant code.
	 * @param defaultManager
	 * @param req
	 */
	public async getOrCreateConnection(defaultManager: EntityManager, req: MedusaRequest): Promise<EntityManager> {
		// TODO: Remove once medusa allow to store custom configuration
		const { configModule } = getConfigFile(process.cwd(), 'medusa-config') as {
			configModule: ConfigModule;
		};

		if (!configModule.multi_tenancy?.tenant_code_resolver) {
			throw new Error('Missing tenant_code_resolver from multi_tenancy config in medusa-config.');
		}
		const tenantCode = configModule.multi_tenancy.tenant_code_resolver(req);
		if (!tenantCode) {
			return defaultManager;
		}

		const tenant = configModule.multi_tenancy.tenants.find((tenantConfig) => {
			return tenantConfig.code === tenantCode;
		});
		if (!tenant) {
			throw new Error(
				'Unable to find the tenant from the code found. Please check that the tenant code is part of the config.'
			);
		}

		const connectionManager = getConnectionManager();

		let connection!: Connection;
		if (connectionManager.has(tenant.code)) {
			connection = await connectionManager.get(tenant.code);
		} else {
			const db_entities = req.scope.resolve('db_entities') as any[];
			await createConnection({
				name: tenant.code,
				type: tenant.database_config.database_type as any,
				url: tenant.database_config.database_url,
				database: tenant.database_config.database_database,
				extra: tenant.database_config.database_extra || {},
				entities: db_entities,
				namingStrategy: new ShortenedNamingStrategy(),
				logging: configModule.projectConfig.database_logging ?? false,
			});

			connection = await connectionManager.get(tenant.code);
		}

		return await new Promise((resolve) => {
			connection.isConnected
				? resolve(connection.manager)
				: connection.connect().then((conn) => resolve(conn.manager));
		});
	}
}
