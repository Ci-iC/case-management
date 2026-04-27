// 修：删用户时被外键约束阻止
//
// 原本 9 个外键都是 NO ACTION（删用户 → 报错）。改成 SET NULL，
// 同时把几个 NOT NULL 列改成 nullable，让删除"前用户"时数据保留：
// 案件/审核/消息等历史不丢，actor 显示为"已删除用户"。
//
// 历史审计场景需要这种"软引用"：人走了，记录留着。

const FKS = [
  { table: 'audit_logs',    col: 'actor_id',    nullable: true  },
  { table: 'cases',         col: 'created_by',  nullable: false },  // 改 nullable
  { table: 'cases',         col: 'updated_by',  nullable: true  },
  { table: 'case_versions', col: 'changed_by',  nullable: true  },
  { table: 'case_reviews',  col: 'created_by',  nullable: false },  // 改 nullable
  { table: 'messages',      col: 'sender_id',   nullable: false },  // 改 nullable
  { table: 'messages',      col: 'receiver_id', nullable: false },  // 改 nullable
  { table: 'pipelines',     col: 'created_by',  nullable: true  },
  { table: 'app_settings',  col: 'updated_by',  nullable: true  },
]

export async function up(knex) {
  for (const fk of FKS) {
    const constraintName = `${fk.table}_${fk.col}_foreign`
    // 1. 先取消 NOT NULL（如有）
    if (!fk.nullable) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [fk.table, fk.col])
    }
    // 2. 删旧外键
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT ??`, [fk.table, constraintName])
    // 3. 加新外键 ON DELETE SET NULL
    await knex.raw(
      `ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES users(id) ON DELETE SET NULL`,
      [fk.table, constraintName, fk.col],
    )
  }
}

export async function down(knex) {
  // down 不严格还原 NOT NULL（因为期间可能已经写入 NULL 行，回滚会失败）。
  // 只回滚外键的 SET NULL 行为为 NO ACTION。
  for (const fk of FKS) {
    const constraintName = `${fk.table}_${fk.col}_foreign`
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT ??`, [fk.table, constraintName])
    await knex.raw(
      `ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES users(id)`,
      [fk.table, constraintName, fk.col],
    )
  }
}
