// v2.0: 多公司多租户改造
//
// 设计目标：
//   - 把单租户系统改造成"一个平台、N 家公司"的架构
//   - 数据强隔离：公司间业务数据不可见（合同/审核/审批/消息/案件）
//   - 平台层：superadmin 不归属任何公司，做平台级管理（建公司、分配用户、配审批流模板、看跨公司只读数据）
//   - 公司层角色：manager(企业管理人员) / legal(法务) / seal_admin(印章管理) / finance(财务) / staff(普通员工)
//
// 关键设计：
//   - users 表保留（用户身份本身是平台级的），但 role 字段只保留 'superadmin' / 'platform_user' 两个值；
//     具体的公司角色放到 user_company_roles 关联表
//   - 一个用户可在多家公司有不同角色
//   - 业务表都加 company_id（NOT NULL，必须归属某家公司）
//   - pipelines（审核模型）的 company_id 允许 NULL → 表示"全平台共享模板"，超管出厂模板都是 NULL
//   - app_settings 不加 company_id → 仍是平台级配置
//   - audit_logs 加 company_id（可空，平台级操作如建公司时无 company_id）
//
// 数据迁移：
//   - 建默认公司"总部"
//   - 现有所有业务数据（contracts/cases/case_reviews/approvals/...）的 company_id 设为该公司
//   - 现有 users.role 映射：
//       superadmin → 保持 superadmin（平台超管，不归属任何公司）
//       admin      → 总部 manager + legal（保留原有"管理员 + 法务"双重权限）
//       user       → 总部 staff，根据 can_view_cases / can_view_contracts 补充角色（看案件 → +legal；看合同 → 也是 staff 即可）

const COMPANY_ROLES = ['manager', 'legal', 'seal_admin', 'finance', 'staff']

export async function up(knex) {
  // ─── 1. companies 表 ──────────────────────────────────────────────────────────
  await knex.schema.createTable('companies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('name').notNullable()
    t.text('code')                                  // 公司简称（可空，UI 紧凑展示用）
    t.text('status').notNullable().defaultTo('active')
    t.text('description')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.text('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['status'], 'idx_companies_status')
  })
  await knex.raw(`ALTER TABLE companies ADD CONSTRAINT companies_status_chk CHECK (status IN ('active','inactive'))`)
  await knex.raw(`CREATE UNIQUE INDEX uniq_companies_name ON companies (name) WHERE status = 'active'`)

  // ─── 2. user_company_roles 关联表 ─────────────────────────────────────────────
  await knex.schema.createTable('user_company_roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
    t.text('role').notNullable()
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.text('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.unique(['user_id', 'company_id', 'role'], { indexName: 'uniq_user_company_role' })
    t.index(['user_id'], 'idx_ucr_user')
    t.index(['company_id'], 'idx_ucr_company')
  })
  await knex.raw(
    `ALTER TABLE user_company_roles ADD CONSTRAINT ucr_role_chk
     CHECK (role IN ('${COMPANY_ROLES.join("','")}'))`
  )

  // ─── 3. 业务表加 company_id（先允许 NULL，回填后再 NOT NULL） ────────────────
  // 注意：cases / case_versions 不加 company_id —— 案件台账由所有公司的法务岗共用，
  //       不归属任何公司，没有公司隔离。
  const BIZ_TABLES = [
    'case_reviews',
    'contracts',
    'approvals',
    'approval_steps',
    'approval_actions',
    'messages',
    'pipelines',          // 审核模型（允许 NULL = 全平台共享）
    'pipeline_steps',     // pipelines 的子表也加，便于直接查
    'audit_logs',         // 平台级操作可空
  ]
  for (const tbl of BIZ_TABLES) {
    await knex.schema.alterTable(tbl, (t) => {
      t.uuid('company_id').references('id').inTable('companies').onDelete('CASCADE')
    })
  }

  // ─── 4. 数据迁移：建默认公司"总部"，把现有数据归过去 ─────────────────────────
  //    用户全部数据视为"总部"归属（用户确认这是单租户阶段的所有积累数据）
  const [defaultCompany] = await knex('companies').insert({
    name: '总部',
    code: 'HQ',
    status: 'active',
    description: 'v1.x 单租户阶段的默认公司，平台升级 v2.0 多租户时自动创建',
  }, ['id'])
  const HQ_ID = defaultCompany.id

  // 业务数据全部归 HQ（cases / case_versions 不归属公司，跳过）
  for (const tbl of ['case_reviews', 'contracts', 'approvals', 'approval_steps',
    'approval_actions', 'messages', 'audit_logs', 'pipeline_steps']) {
    await knex(tbl).update({ company_id: HQ_ID })
  }
  // pipelines：现有 pipelines（含出厂的"通用合同审核"）保留 company_id=NULL 作全平台共享
  // 不需要回填。

  // ─── 5. 业务表 company_id 改为 NOT NULL（pipelines / pipeline_steps / audit_logs 保留可空） ─
  for (const tbl of ['case_reviews', 'contracts', 'approvals',
    'approval_steps', 'approval_actions', 'messages']) {
    await knex.raw(`ALTER TABLE ${tbl} ALTER COLUMN company_id SET NOT NULL`)
  }
  // pipeline_steps 跟随 pipeline 走，pipeline 是 NULL 它也是 NULL；保持可空
  // pipelines / audit_logs 维持可空（NULL = 全平台共享 / 平台级操作）

  // ─── 6. 索引（业务表常按 company_id 过滤） ───────────────────────────────────
  for (const tbl of ['case_reviews', 'contracts', 'approvals',
    'approval_steps', 'approval_actions', 'messages', 'audit_logs', 'pipelines']) {
    await knex.raw(`CREATE INDEX idx_${tbl}_company ON ${tbl} (company_id)`)
  }

  // ─── 7. users.role 收敛：admin → 拆角色到 user_company_roles ─────────────────
  //    admin → 总部 manager + legal（保留原有"管理员 + 法务"双重权限）
  //    user  → 总部 staff（基础角色）
  //          + can_view_cases=true → 加 legal（看全部案件台账）
  //          + can_view_contracts=true → 加 manager（看全部合同台账）
  //    superadmin → 平台超管，不归属公司
  //
  //    注意：v1.3.2 软删除的用户也要照映射，但他们没法登录，本质无影响；
  //    映射后 user_company_roles 唯一约束确保不会重复

  const allUsers = await knex('users').select('id', 'role', 'can_view_cases', 'can_view_contracts')
  for (const u of allUsers) {
    if (u.role === 'superadmin') continue   // 超管不归属公司

    const rolesToAdd = new Set()
    if (u.role === 'admin') {
      rolesToAdd.add('manager')
      rolesToAdd.add('legal')
    } else {
      // role === 'user'
      rolesToAdd.add('staff')
      if (u.can_view_cases) rolesToAdd.add('legal')
      if (u.can_view_contracts) rolesToAdd.add('manager')
    }
    for (const role of rolesToAdd) {
      await knex('user_company_roles').insert({
        user_id: u.id,
        company_id: HQ_ID,
        role,
        created_by: null,
      })
    }
  }

  // ─── 8. users 表的 role 收敛为 superadmin / platform_user 二值 ───────────────
  //    所有非 superadmin 一律改为 platform_user；公司层角色看 user_company_roles
  //    can_view_cases / can_view_contracts 字段不删（保留兼容老代码读取，但写入逻辑改为只读字段）
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk`)
  await knex('users').whereNot('role', 'superadmin').update({ role: 'platform_user' })
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('superadmin','platform_user'))`)
}

export async function down(knex) {
  // ─── 反向：把业务表 company_id 去掉，恢复 users.role 旧约束 ──────────────────

  // 1. users.role 还原（platform_user → user，没法精确还原成 admin，但 admin 在 ucr 里有映射可参考）
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk`)
  // 把 user_company_roles 里 manager 角色对应的 user → admin（取第一个 manager 的 user 作为 admin）
  // 简化：down 不精确还原，把所有 platform_user 改为 user
  await knex('users').where('role', 'platform_user').update({ role: 'user' })
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('superadmin','admin','user'))`)

  // 2. 删除索引、company_id 列（cases / case_versions 没加，跳过）
  for (const tbl of ['case_reviews', 'contracts', 'approvals',
    'approval_steps', 'approval_actions', 'messages', 'audit_logs', 'pipelines']) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${tbl}_company`)
  }
  for (const tbl of ['case_reviews', 'contracts', 'approvals',
    'approval_steps', 'approval_actions', 'messages', 'pipelines', 'pipeline_steps', 'audit_logs']) {
    await knex.schema.alterTable(tbl, (t) => {
      t.dropColumn('company_id')
    })
  }

  // 3. 删关联表 + 公司表
  await knex.schema.dropTableIfExists('user_company_roles')
  await knex.schema.dropTableIfExists('companies')
}
