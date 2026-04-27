import 'dotenv/config'

const config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgres://case_mgmt:changeme@127.0.0.1:5432/case_mgmt',
  migrations: {
    directory: './server/migrations',
    extension: 'js',
    loadExtensions: ['.js'],
  },
  pool: { min: 2, max: 10 },
}

export default config
