# 科研项目材料管理系统
# API 接口清单

- Base URL：`http://host:8080/api`
- 认证：除登录、健康检查、公开大屏外，均需请求头 `Authorization: Bearer <token>`
- 请求/响应：`application/json; charset=UTF-8`
- 日期：`yyyy-MM-dd`
- 金额：万元
- 文件上传：`multipart/form-data`
- 统一响应：`{ "code": 0, "message": "ok", "data": ... }`

## 1. 状态码

| HTTP | 业务码 | 含义 |
| --- | --- | --- |
| 200 | 0 | 成功 |
| 400 | 400 | 参数错误、业务校验失败 |
| 401 | 401 | 未登录、Token 过期/无效 |
| 403 | 403 | 无权限 |
| 404 | 404 | 资源不存在 |
| 409 | 409 | 唯一键冲突、状态冲突 |
| 413 | 413 | 上传文件过大 |
| 500 | 500 | 服务异常 |

## 2. 认证

### 2.1 登录

`POST /auth/login`（无需 Token）

```json
{
  "username": "admin",
  "password": "Admin@123"
}
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "MToxNzkz...",
    "user": {
      "id": 1,
      "username": "admin",
      "realName": "系统管理员",
      "roleCode": "ADMIN",
      "roleLabel": "系统管理员",
      "deptId": 3,
      "deptName": "科技管理部",
      "phone": "13800000001",
      "email": "admin@example.com",
      "status": true,
      "lastLoginAt": "2026-11-05T00:29:38"
    }
  }
}
```

### 2.2 当前用户

`GET /auth/me`

返回当前用户信息和权限标识列表。

### 2.3 退出登录

`POST /auth/logout`

无状态 Token，服务端不维护会话，前端清除本地 Token 即可。

### 2.4 修改密码

`PUT /auth/password`

```json
{
  "oldPassword": "Admin@123",
  "newPassword": "NewPass@2026"
}
```

新密码至少 8 位，需同时包含字母和数字。

## 3. 健康检查

`GET /health`（无需 Token）

```json
{
  "code": 0,
  "message": "ok",
  "data": { "status": "UP", "service": "research-material-backend", "time": "2026-11-05T00:42:00" }
}
```

## 4. 看板与公开大屏

### 4.1 内部看板

`GET /dashboard`

角色：登录用户（项目经理自动限定本人项目）。

返回：

```json
{
  "summary": {
    "totalProjects": 3,
    "activeProjects": 2,
    "completedProjects": 1,
    "terminatedProjects": 0,
    "completionRate": 33.3,
    "totalBudget": 255.00,
    "totalSpent": 192.00,
    "fundingRate": 75.3,
    "dueMaterials": 28,
    "onTimeMaterials": 18,
    "onTimeMaterialRate": 64.3,
    "overdueMaterials": 10,
    "upcomingMaterials": 3,
    "dueReports": 18,
    "submittedReports": 16,
    "quarterlyFillRate": 88.9,
    "overdueReports": 2,
    "upcomingReports": 0,
    "overdueTotal": 12,
    "upcomingDays": 30
  },
  "statusDistribution": [{ "status": "ACTIVE", "count": 1 }],
  "categoryDistribution": [{ "category": "纵向", "count": 3 }],
  "deptStats": [{ "deptName": "技术研发部", "projectCount": 2, "completedCount": 1, "totalBudget": 206.00, "totalSpent": 148.00 }],
  "stageStats": [{ "stageCode": "START", "stageName": "项目启动", "projectCount": 4, "completedCount": 4 }],
  "projects": [],
  "alerts": []
}
```

### 4.2 公开大屏

`GET /public/display?key=research-display-2026`（无需 Token）

错误访问码返回 403。返回专门用于大屏的数据结构：

| 字段 | 说明 |
| --- | --- |
| `summary` | 项目总数、在研、已完成、验收待办、知识产权归集项目、累计投入、经费执行率、材料按时率、逾期数 |
| `fundingTrend` | 当前年度月度研发投入：`year`、`total`、`points[{month,amount,cumulative}]` |
| `categoryStats` | 材料分类统计：`category`、`total`、`done` |
| `projects` | 项目卡片，含 `stages` 节点数组、`acceptanceDone`、`acceptanceTotal` |
| `alerts` | 逾期材料/报表列表 |
| `generatedAt` | 数据生成时间 |

`projects[].stages` 字段：`stageCode`、`stageName`、`seqNo`、`plannedStart`、`plannedEnd`、`status`、`materialTotal`、`materialDone`。

## 5. 项目

### 5.1 项目列表

`GET /projects`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | string | 否 | 项目名称/编号/经理/部门模糊搜索 |
| `status` | string | 否 | 项目状态 |
| `deptId` | long | 否 | 部门 |
| `category` | string | 否 | 类别 |
| `managerId` | long | 否 | 项目经理 |
| `overdueOnly` | boolean | 否 | 仅看有逾期事项的项目 |
| `page` | int | 否 | 默认 1 |
| `size` | int | 否 | 默认 10，最大 100 |

返回 `PageResult<ProjectView>`，项目视图包含 `materialTotal`、`materialDone`、`overdueMaterials`、`overdueReports`、`quarterlyTotal`、`quarterlySubmitted`、`nextMaterialName`、`nextMaterialDue` 等派生字段。

### 5.2 项目下拉选项

`GET /projects/options`

返回当前用户可见项目的精简列表。

### 5.3 项目详情

`GET /projects/{id}`

返回项目字段 + 上述派生字段 + `stageProgress` 节点进度数组。

### 5.4 新建项目

`POST /projects`

角色：ADMIN、RESEARCH_MANAGER、PROJECT_MANAGER。

```json
{
  "projectCode": "",
  "erpProjectNo": "ERP-2026-001",
  "procurementRequestNo": "CG-2026-018",
  "inquiryNo": "XB-2026-006",
  "projectName": "智能检测技术研究",
  "category": "纵向",
  "projectLevel": "集团级",
  "projectSource": "集团科技计划",
  "deptId": 1,
  "managerId": 3,
  "participants": "张三,李四",
  "startDate": "2026-01-01",
  "endDate": "2027-12-31",
  "budgetTotal": 100.00,
  "fundingSource": "集团科技经费",
  "status": "ACTIVE",
  "progress": 10,
  "description": "项目简介"
}
```

创建后自动生成节点、材料、季度报表。返回项目详情。

### 5.5 修改项目

`PUT /projects/{id}`

角色：ADMIN、RESEARCH_MANAGER、项目经理本人（不可转交）。

请求体同新建。修改起止日期会重算计划节点、未提交材料截止日期，并补齐季度报表。

### 5.6 删除项目

`DELETE /projects/{id}`

角色：ADMIN、RESEARCH_MANAGER、项目经理本人。

逻辑删除，返回 `{code:0}`。

### 5.7 项目节点

`GET /projects/{id}/stages`

返回节点列表及材料完成数：

```json
[
  {
    "id": 1,
    "stageCode": "START",
    "stageName": "项目启动",
    "seqNo": 10,
    "plannedStart": "2024-11-22",
    "plannedEnd": "2024-12-27",
    "actualStart": "2024-11-22",
    "actualEnd": "2024-12-27",
    "status": "COMPLETED",
    "materialTotal": 2,
    "materialDone": 2
  }
]
```

### 5.8 更新节点备注

`PUT /projects/stages/{stageId}`

```json
{ "remark": "节点说明" }
```

角色：ADMIN、RESEARCH_MANAGER、项目经理本人。

## 6. 材料

### 6.1 项目材料列表

`GET /projects/{projectId}/materials`

可选参数 `stageId`。

返回字段包括 `displayStatus`（PENDING/SUBMITTED/LATE/WAIVED/OVERDUE）、`overdueDays`、`attachmentCount`、`latestFileName`、`submittedByName` 等。

### 6.2 更新材料备注

`PUT /materials/{id}`

```json
{ "note": "备注内容" }
```

角色：ADMIN、RESEARCH_MANAGER、项目经理本人。

### 6.3 标记无需提交

`POST /materials/{id}/waive`

```json
{ "reason": "本项目不适用该材料" }
```

角色：ADMIN、RESEARCH_MANAGER。原因必填。

### 6.4 重置材料

`POST /materials/{id}/reset`

```json
{ "reason": "误标记，重置" }
```

角色：ADMIN、RESEARCH_MANAGER。状态回到 `PENDING`。

### 6.5 材料附件列表

`GET /materials/{id}/attachments`

### 6.6 上传材料附件

`POST /materials/{id}/attachments`

`multipart/form-data`：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | file | 是 | 单文件，默认 ≤50MB |
| `lateReason` | string | 否 | 逾期补传说明 |

角色：ADMIN、RESEARCH_MANAGER、项目经理本人。

首次上传：根据当前日期与截止日期设置 `SUBMITTED` 或 `LATE`；追加附件不改变首次提交时间和状态。

## 7. 季度报表

### 7.1 项目季度报表列表

`GET /projects/{projectId}/quarterly`

返回每期报表，含 `displayStatus`、`overdueDays`、`attachmentCount`、`submittedByName` 等。

### 7.2 同步季度周期

`POST /projects/{projectId}/quarterly/sync`

角色：项目可维护者。补齐缺失季度行，不删除历史行。

### 7.3 保存/提交/撤回

`PUT /quarterly/{id}`

```json
{
  "summary": "本期执行情况",
  "achievements": "阶段成果",
  "issues": "存在问题",
  "nextPlan": "下期计划",
  "budgetSpentPeriod": 5.0,
  "budgetSpentCumulative": 20.0,
  "action": "SUBMIT"
}
```

`action` 取值：

- `SAVE`：保存草稿（默认）。
- `SUBMIT`：提交，`summary` 必填。
- `REOPEN`：撤回到待填报，仅 ADMIN/RESEARCH_MANAGER，可只传 `{ "action": "REOPEN" }`。

### 7.4 报表摘要

`GET /quarterly/{id}`

返回报表期间、状态、截止日期等摘要。

### 7.5 报表附件

- `GET /quarterly/{id}/attachments`
- `POST /quarterly/{id}/attachments`（multipart `file`）

### 7.6 全局季度台账

`GET /quarterly`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `state` | string | ALL/OVERDUE/PENDING/SUBMITTED/LATE |
| `year` | int | 年度 |
| `quarter` | int | 1—4 |
| `keyword` | string | 项目名称、编号、ERP编号 |
| `page` / `size` | int | 分页 |

返回 `{items,total,page,size}`，字段包含 `projectId`、`projectName`、`reportYear`、`reportQuarter`、`periodLabel`、`dueDate`、`displayStatus`、`overdueDays`、`submittedAt`、`attachmentCount` 等。

## 8. 经费

### 8.1 经费明细

`GET /projects/{projectId}/funding`

### 8.2 登记支出

`POST /projects/{projectId}/funding`

```json
{
  "recordDate": "2026-11-05",
  "amount": 1.25,
  "fundingType": "自筹",
  "costCategory": "其他",
  "description": "测试支出"
}
```

金额 > 0，日期不得晚于今天。

### 8.3 修改/删除支出

- `PUT /projects/{projectId}/funding/{id}`
- `DELETE /projects/{projectId}/funding/{id}`

保存后自动重算项目累计支出。

## 9. 附件

### 9.1 项目全部附件

`GET /projects/{id}/attachments`

### 9.2 删除附件

`DELETE /attachments/{id}`

逻辑删除；若删除材料最后一个附件，材料回退为待提交。

### 9.3 下载

`GET /attachments/{id}/download`

需要 Token，返回二进制流，`Content-Disposition: attachment`。

### 9.4 预览

`GET /attachments/{id}/preview`

需要 Token，`Content-Disposition: inline`。浏览器支持 PDF/图片/文本时直接展示。

## 10. 提醒

### 10.1 提醒列表

`GET /alerts`

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `type` | ALL | ALL / MATERIAL / REPORT |
| `state` | OVERDUE | OVERDUE / UPCOMING / ALL |
| `page` | 1 | 页码 |
| `size` | 20 | 每页 |

返回字段：`alertType`、`targetId`、`projectId`、`projectCode`、`projectName`、`deptName`、`managerName`、`itemName`、`phase`、`dueDate`、`overdueDays`、`daysLeft`、`status`、`attachmentCount`。

### 10.2 提醒汇总

`GET /alerts/summary`

```json
{
  "overdueMaterials": 10,
  "overdueReports": 2,
  "upcomingMaterials": 3,
  "upcomingReports": 0,
  "overdueTotal": 12,
  "upcomingDays": 30
}
```

## 11. 流程模板

### 11.1 节点

- `GET /templates/stages`
- `POST /templates/stages`
- `PUT /templates/stages/{id}`
- `DELETE /templates/stages/{id}`（停用）

请求示例：

```json
{
  "stageCode": "REVIEW",
  "stageName": "过程评审",
  "seqNo": 35,
  "startRatio": 0.3,
  "endRatio": 0.4,
  "startOffsetDays": 0,
  "endOffsetDays": 0,
  "description": "过程评审节点",
  "enabled": true
}
```

### 11.2 材料

- `GET /templates/materials?stageId=1`
- `POST /templates/materials`
- `PUT /templates/materials/{id}`
- `DELETE /templates/materials/{id}`（停用）

请求示例：

```json
{
  "templateCode": "M-REVIEW-01",
  "stageId": 4,
  "materialCategory": "TESTING",
  "materialName": "过程评审意见",
  "required": true,
  "dueAnchor": "STAGE_END",
  "dueOffsetDays": 0,
  "allowLate": true,
  "description": "评审意见及整改说明",
  "sortNo": 10,
  "enabled": true
}
```

写操作角色：ADMIN、RESEARCH_MANAGER。

## 12. 系统管理

### 12.1 用户

- `GET /users?keyword=&roleCode=`
- `POST /users`
- `PUT /users/{id}`
- `PUT /users/{id}/password`

创建示例：

```json
{
  "username": "lisi",
  "password": "Init@2026",
  "realName": "李四",
  "roleCode": "PROJECT_MANAGER",
  "deptId": 1,
  "phone": "13800000005",
  "email": "lisi@example.com",
  "status": true
}
```

角色：仅 ADMIN。

### 12.2 部门

- `GET /depts`
- `POST /depts`
- `PUT /depts/{id}`

### 12.3 操作日志

`GET /logs?page=1&size=20`

角色：ADMIN、RESEARCH_MANAGER。

### 12.4 字典选项

`GET /meta/options`

返回部门、项目经理、角色、项目类别、级别、状态、经费类型、支出科目等前端下拉数据。

## 13. cURL 示例

```bash
# 登录
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | jq -r '.data.token')

# 看板
curl -s http://127.0.0.1:8080/api/dashboard -H "Authorization: Bearer $TOKEN"

# 上传材料
curl -s -X POST http://127.0.0.1:8080/api/materials/1/attachments \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./开题报告.pdf" \
  -F "lateReason=补充历史材料"

# 下载附件
curl -s http://127.0.0.1:8080/api/attachments/1/download \
  -H "Authorization: Bearer $TOKEN" -o attachment.bin
```

## 14. 接口扩展约定

- 新接口统一返回 `ApiResponse`。
- 新写操作需调用 `OperationLogService.log`。
- 项目数据权限使用 `PermissionService`，不要只在 Controller 判断。
- 列表分页统一 `PageResult`，页码从 1 开始。
- 新增状态时同步更新前端 `utils/format.js` 字典。

## 15. 分类材料台账接口

### 15.1 分类项目台账

`GET /categories/{category}/projects`

`category` 取值：`INITIATION`、`PROCUREMENT`、`CHANGE`、`TESTING`、`IP`、`ACCEPTANCE`、`ARCHIVE`、`OTHER`。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `keyword` | string | 项目名称、内部编号、ERP编号、采购申请编号、询比编号、经理 |
| `deptId` | long | 承担部门 |
| `status` | string | 项目状态 |
| `pendingOnly` | boolean | 仅看材料未齐 |
| `page` / `size` | int | 分页 |

返回：

```json
{
  "items": [
    {
      "id": 1,
      "projectCode": "研4C54/ZY0028",
      "erpProjectNo": "ERP-4C54ZY0028",
      "procurementRequestNo": "CG-4C54ZY0028",
      "inquiryNo": "XB-4C54ZY0028",
      "projectName": "反光背心和安全帽穿戴事件检测算法模型训练研究",
      "status": "FINAL",
      "progress": 92,
      "deptName": "数智研发中心",
      "managerName": "邓建平",
      "materialTotal": 4,
      "materialDone": 4,
      "overdueMaterials": 0,
      "stepStatuses": "1~M-INIT-01~科研建议书（附件1）~SUBMITTED||2~M-INIT-02~可行性研究报告（附件2）~SUBMITTED"
    }
  ],
  "total": 4,
  "page": 1,
  "size": 20,
  "category": "INITIATION"
}
```

`stepStatuses` 每项格式：`materialId~materialCode~materialName~displayStatus`，以 `||` 分隔。`displayStatus` 取值 `PENDING`、`SUBMITTED`、`LATE`、`WAIVED`、`OVERDUE`。

### 15.2 业务分类

| 分类 | 页面 | 说明 |
| --- | --- | --- |
| INITIATION | 立项管理 | 附件1—4 |
| PROCUREMENT | 采购管理 | 5.2-1—5.2-7 |
| CHANGE | 变更管理 | 附件5.3 |
| TESTING | 检测报告 | 附件5.4 |
| IP | 知识产权 | 附件5.5 |
| ACCEPTANCE | 验收管理 | 附件6—9 |
| ARCHIVE | 归档材料 | 档案移交/成果登记 |
