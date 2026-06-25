// v2.4: 审批步骤固化"节点角色 / 节点标签"
//
// 业务背景：
//   审批流最后两个节点通常是「印章管理员用印」和「经办人上传盖章扫描件」。
//   印章管理员常由财务 / 人力等同事兼任 —— 一个人可能同时是财务岗和印章管理岗，
//   配置审批流时财务节点和用印节点都会落到他名下。
//   v2.1 起前端是靠"处理人在本公司是否含 seal_admin 角色"来推断用印节点的，
//   这会把上面那种双角色人担任的"财务节点"误判成"用印节点"。
//
// 改造：
//   节点身份只认"流程节点配置的角色"，不再看处理人本身的角色。
//   - 发起审批时按模板把每一步的 role / step_label 直接写进 approval_steps（见 routes/approvals.js）。
//   - 本迁移把"已在途/历史"审批的 step_role / step_label 一并回填：
//       从该审批发起时记录的 templateId（approval_actions.action='submit' 的 payload）
//       回到 approval_template_steps，按 step_index 取出当初配置的 role / step_label。
//     —— 用"当初配置"而非"处理人身份"回填，从根上消除误判。
//
//   两列均可空。极个别老审批若发起记录缺失 templateId，则保持 NULL，
//   前后端对 NULL 一律按"普通审批"处理（绝不回退到看处理人身份）。

export async function up(knex) {
  await knex.schema.alterTable('approval_steps', (t) => {
    t.text('step_role')
    t.text('step_label')
  })

  // ─── 回填历史/在途审批 ──────────────────────────────────────────────────────
  // 1) approval_id -> templateId（取发起时的 submit 记录）
  const submits = await knex('approval_actions')
    .where('action', 'submit')
    .whereNotNull('payload')
    .select('approval_id', 'payload')
  const tmplByApproval = new Map()
  for (const s of submits) {
    let payload = s.payload
    if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch { payload = null } }
    const tid = payload?.templateId
    if (tid && !tmplByApproval.has(s.approval_id)) tmplByApproval.set(s.approval_id, tid)
  }

  if (tmplByApproval.size > 0) {
    // 2) (templateId, step_index) -> { role, step_label }
    const templateIds = [...new Set(tmplByApproval.values())]
    const tmplSteps = await knex('approval_template_steps')
      .whereIn('template_id', templateIds)
      .select('template_id', 'step_index', 'role', 'step_label')
    const roleByKey = new Map()
    for (const ts of tmplSteps) {
      roleByKey.set(`${ts.template_id}#${ts.step_index}`, { role: ts.role, label: ts.step_label || null })
    }

    // 3) 逐个 approver 步骤回填（只按节点配置，不看处理人身份）
    const steps = await knex('approval_steps')
      .where('step_type', 'approver')
      .whereNull('step_role')
      .select('id', 'approval_id', 'step_index')
    for (const st of steps) {
      const tid = tmplByApproval.get(st.approval_id)
      if (!tid) continue
      const hit = roleByKey.get(`${tid}#${st.step_index}`)
      if (!hit) continue
      await knex('approval_steps').where({ id: st.id }).update({
        step_role: hit.role,
        step_label: hit.label,
      })
    }
  }

  // 4) 经办人最终节点统一补一个可读标签
  await knex('approval_steps')
    .where('step_type', 'final-initiator')
    .whereNull('step_label')
    .update({ step_label: '上传盖章扫描件' })
}

export async function down(knex) {
  await knex.schema.alterTable('approval_steps', (t) => {
    t.dropColumn('step_role')
    t.dropColumn('step_label')
  })
}
