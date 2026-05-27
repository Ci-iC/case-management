// v2.1+: 公司角色表（自定义角色 + 看合同权限开关）
//
// 业务背景：
//   v2.0 的公司层角色是写死在代码里的 5 个 enum
//   （manager / legal / finance / seal_admin / staff），且"能看本公司全部合同"
//   的判断也是写死。v2.1 进一步把角色做成"每家公司一份"的可配置表，
//   并给每个角色加 can_view_all_contracts 开关。
//
// 设计要点：
//   - company_roles：每家公司一套角色清单（5 个系统角色 + 任意自定义角色）
//   - is_system=true 标记 5 个固定角色，名字/key 不允许超管改；can_view_all_contracts 允许改
//   - 自定义角色：超管自由建/改/删，key 由系统生成（'role_<短uuid>'）
//   - user_company_roles.role 和 approval_template_steps.role
//     从枚举 CHECK 改为指向 company_roles(company_id, key) 的复合 FK，
//     这样自定义角色也能被引用，且 DB 层强约束。
//
// 看合同新规则（落在 server/auth.js / contracts.js）：
//   用户在本公司任意一个角色 can_view_all_contracts=true → 看本公司全部
//   否则 → 仅看自己创建 / 自己经办的（沿用现行 staff 逻辑）

const SYSTEM_ROLES = [
  { key: 'manager',    name: '企业管理人员', can_view_all_contracts: true,  sort_order: 1 },
  { key: 'legal',      name: '法务岗',       can_view_all_contracts: true,  sort_order: 2 },
  { key: 'finance',    name: '财务人员',     can_view_all_contracts: true,  sort_order: 3 },
  { key: 'seal_admin', name: '印章管理岗',   can_view_all_contracts: false, sort_order: 4 },
  { key: 'staff',      name: '普通员工',     can_view_all_contracts: false, sort_order: 5 },
]

export async function up(knex) {
  // ─── 1. company_roles 表 ─────────────────────────────────────────────────
  await knex.schema.createTable('company_roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
    t.text('key').notNullable()
    t.text('name').notNullable()
    t.boolean('can_view_all_contracts').notNullable().defaultTo(false)
    t.boolean('is_system').notNullable().defaultTo(false)
    t.integer('sort_order').notNullable().defaultTo(100)
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.unique(['company_id', 'key'], { indexName: 'uniq_company_role_key' })
    t.index(['company_id'], 'idx_company_roles_company')
  })
  // key 规范：小写字母 + 数字 + 下划线，必须以字母开头
  await knex.raw(
    `ALTER TABLE company_roles ADD CONSTRAINT company_roles_key_chk
     CHECK (key ~ '^[a-z][a-z0-9_]*$')`
  )

  // ─── 2. 给所有现有公司 seed 5 个系统角色 ────────────────────────────────
  const companies = await knex('companies').select('id')
  if (companies.length > 0) {
    const rows = []
    for (const c of companies) {
      for (const r of SYSTEM_ROLES) {
        rows.push({
          company_id: c.id,
          key: r.key,
          name: r.name,
          can_view_all_contracts: r.can_view_all_contracts,
          is_system: true,
          sort_order: r.sort_order,
        })
      }
    }
    await knex('company_roles').insert(rows)
  }

  // ─── 3. user_company_roles：去 enum CHECK，加复合 FK ────────────────────
  await knex.raw('ALTER TABLE user_company_roles DROP CONSTRAINT IF EXISTS ucr_role_chk')
  await knex.raw(`
    ALTER TABLE user_company_roles
    ADD CONSTRAINT ucr_role_fk
    FOREIGN KEY (company_id, role)
    REFERENCES company_roles (company_id, key)
    ON DELETE CASCADE
    ON UPDATE CASCADE
  `)

  // ─── 4. approval_template_steps：加 company_id 列 + 复合 FK ─────────────
  await knex.schema.alterTable('approval_template_steps', (t) => {
    t.uuid('company_id')
  })
  // 回填 company_id（从 approval_templates 拿）
  await knex.raw(`
    UPDATE approval_template_steps ats
    SET company_id = at.company_id
    FROM approval_templates at
    WHERE ats.template_id = at.id
  `)
  await knex.raw('ALTER TABLE approval_template_steps ALTER COLUMN company_id SET NOT NULL')

  await knex.raw('ALTER TABLE approval_template_steps DROP CONSTRAINT IF EXISTS approval_template_steps_role_chk')
  await knex.raw(`
    ALTER TABLE approval_template_steps
    ADD CONSTRAINT approval_template_steps_role_fk
    FOREIGN KEY (company_id, role)
    REFERENCES company_roles (company_id, key)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
  `)
  await knex.schema.alterTable('approval_template_steps', (t) => {
    t.index(['company_id'], 'idx_approval_template_steps_company')
  })
}

export async function down(knex) {
  // 反向卸 FK + 列，恢复旧 CHECK
  await knex.raw('ALTER TABLE approval_template_steps DROP CONSTRAINT IF EXISTS approval_template_steps_role_fk')
  await knex.schema.alterTable('approval_template_steps', (t) => {
    t.dropIndex(['company_id'], 'idx_approval_template_steps_company')
    t.dropColumn('company_id')
  })
  await knex.raw(`
    ALTER TABLE approval_template_steps ADD CONSTRAINT approval_template_steps_role_chk
    CHECK (role IN ('legal','finance','manager','seal_admin'))
  `)

  await knex.raw('ALTER TABLE user_company_roles DROP CONSTRAINT IF EXISTS ucr_role_fk')
  await knex.raw(`
    ALTER TABLE user_company_roles ADD CONSTRAINT ucr_role_chk
    CHECK (role IN ('manager','legal','seal_admin','finance','staff'))
  `)

  await knex.schema.dropTableIfExists('company_roles')
}

// 给应用层 seed 用：当新建公司时调一遍这个，把 5 个系统角色塞进去
export const SYSTEM_ROLE_SEED = SYSTEM_ROLES
