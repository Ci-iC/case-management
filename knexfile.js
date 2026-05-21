import 'dotenv/config'

const config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || (() => { throw new Error('DATABASE_URL 未设置，请在 .env 中配置') })(),
  migrations: {
    directory: './server/migrations',
    extension: 'js',
    loadExtensions: ['.js'],
  },
  pool: { min: 2, max: 10 },
}

export default config
