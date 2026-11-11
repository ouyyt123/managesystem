# 科研项目材料管理系统
# IntelliJ IDEA 启动与配置指南

本文按 **Windows + IntelliJ IDEA + 本机工具链** 说明如何启动 MySQL、后端、前端，如何用 IDEA 连接数据库，以及后端配置修改方式。

## 1. 推荐的打开方式

**不要直接打开 `F:\Deepseekworkplace` 作为项目根目录**，建议单独打开：

```text
F:\Deepseekworkplace\research-material-system
```

原因：

- Maven 模块、前端目录和 `.run` 运行配置都在这个目录下。
- 打开后 IDEA 才能识别 `Backend Local`、`Frontend Dev`、`Backend + Frontend` 三个运行配置。
- 如果已经打开了 `Deepseekworkplace`，可以 `File → Open` 重新选择 `research-material-system`，或把 `backend/pom.xml` 作为 Maven 项目导入。

## 2. 首次配置 IDEA

### 2.1 配置 JDK 17

`File → Project Structure → Project`

- SDK：选择 JDK 17
- Language level：17

如果列表里没有 JDK：

1. 点击 `Add SDK → JDK...`
2. 选择目录：

```text
F:\Deepseekworkplace\tools\jdk-17.0.2
```

### 2.2 配置 Maven

`File → Settings → Build, Execution, Deployment → Build Tools → Maven`

| 配置项 | 值 |
| --- | --- |
| Maven home path | `F:\Deepseekworkplace\tools\apache-maven-3.9.9` |
| User settings file | `F:\Deepseekworkplace\tools\maven-settings.xml` |
| Local repository | `F:\Deepseekworkplace\tools\m2repo`（通常自动读取） |

然后：

1. 在项目树中右键 `backend/pom.xml`
2. 选择 `Add as Maven Project`（如果未自动识别）
3. 等待右下角 Maven 索引完成

### 2.3 配置 Node.js（可选）

`File → Settings → Languages & Frameworks → Node.js`

- Node interpreter：

```text
C:\Users\luo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
```

当前这台机器的 Node 发行包中没有自带 `npm`，只有 `pnpm`，因此**最稳的前端启动方式是用项目自带脚本**：

```powershell
cd F:\Deepseekworkplace\research-material-system
.\scripts\start-frontend.cmd
```

脚本会自动设置 Node 的 PATH、使用 pnpm 启动 Vite。

如果你在别的电脑安装了标准 Node.js 20+（自带 npm），也可以在 IDEA 中直接使用 `Frontend Dev` 运行配置。

## 3. 启动 MySQL 并初始化数据库

### 3.1 启动 MySQL

在 IDEA 底部打开 `Terminal`，执行：

```powershell
cd F:\Deepseekworkplace\research-material-system
.\scripts\start-mysql.cmd
```

本机 MySQL 配置：

| 项目 | 值 |
| --- | --- |
| 地址 | `127.0.0.1` |
| 端口 | `3307` |
| 用户 | `root` |
| 密码 | 空 |
| 数据库 | `research_material` |
| 数据目录 | `F:\Deepseekworkplace\tools\mysqldata` |

如果 3307 已经在监听，脚本会提示“无需重复启动”。

### 3.2 初始化数据库（首次或重置演示数据）

```powershell
.\scripts\init-db.cmd
# 输入 YES 确认
```

注意：该脚本会 **删除并重建** `research_material` 的业务表，只用于首次初始化或重置演示数据。

生产环境不要执行这个脚本，应使用增量迁移 SQL。

## 4. 用 IDEA 连接数据库

### 4.1 打开 Database 工具窗口

`View → Tool Windows → Database`

### 4.2 新建 MySQL 数据源

1. 点击 `+ → Data Source → MySQL`
2. 填写：

| 字段 | 值 |
| --- | --- |
| Name | `Research Material Local` |
| Host | `127.0.0.1` |
| Port | `3307` |
| User | `root` |
| Password | 留空 |
| Database | `research_material` |

3. 如果 IDEA 提示下载驱动，点击 `Download missing driver files`
4. 点击 `Test Connection`

如果测试失败，可以手动填写 JDBC URL：

```text
jdbc:mysql://127.0.0.1:3307/research_material?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
```

5. 在 `Schemas` 页签勾选 `research_material`，设为默认 schema
6. 打开查询控制台，执行：

```sql
SELECT COUNT(*) FROM project;
SELECT project_code, project_name, erp_project_no FROM project;
```

### 4.3 常见数据库连接问题

| 问题 | 处理 |
| --- | --- |
| `Access denied for user 'root'` | 确认端口是 3307；如果 root 有密码，填写密码 |
| `Public Key Retrieval is not allowed` | JDBC URL 加 `allowPublicKeyRetrieval=true` |
| `Communications link failure` | MySQL 没启动，先执行 `start-mysql.cmd` |
| 连到了旧库 | 确认端口是 3307 而不是 3306；本项目 local 配置使用 3307 |
| 表不存在 | 执行 `init-db.cmd` 或在 IDEA 中运行 `db/schema.sql`（会重建表） |

## 5. 启动后端

### 5.1 使用项目自带运行配置

打开项目根目录后，右上角运行配置下拉框应能看到：

```text
Backend Local
Frontend Dev
Backend + Frontend
```

选择 `Backend Local`，点击绿色运行按钮。

`Backend Local` 已配置：

| 配置 | 值 |
| --- | --- |
| Main class | `com.enterprise.research.ResearchMaterialApplication` |
| Active profile | `local` |
| Working directory | `$PROJECT_DIR$/backend` |
| DB_HOST | `127.0.0.1` |
| DB_PORT | `3307` |
| DB_NAME | `research_material` |
| DB_USERNAME | `root` |
| DB_PASSWORD | 空 |
| STORAGE_ROOT | `F:/.../backend/data/uploads` |
| DEMO_ENABLED | `true` |
| 启动参数 | `--server.port=8080 --server.tomcat.basedir=...` |
| VM options | `-Djava.io.tmpdir=.../backend/tmp` |

如果 IDEA 显示“Module not specified”：

1. 打开 `Run → Edit Configurations`
2. 选择 `Backend Local`
3. 在 `Module` 中选择 `research-material-backend`
4. 保存后重新运行

### 5.2 手动新建运行配置

如果 `.run` 配置没有自动出现：

1. `Run → Edit Configurations → + → Application`
2. 填写：

| 字段 | 值 |
| --- | --- |
| Name | `Backend Local` |
| Main class | `com.enterprise.research.ResearchMaterialApplication` |
| Module | `research-material-backend` |
| Working directory | `F:\Deepseekworkplace\research-material-system\backend` |
| Program arguments | `--spring.profiles.active=local --server.port=8080 --server.tomcat.basedir=F:/Deepseekworkplace/research-material-system/backend/data/tomcat` |
| VM options | `-Djava.io.tmpdir=F:/Deepseekworkplace/research-material-system/backend/tmp` |

Environment variables：

```text
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=research_material
DB_USERNAME=root
DB_PASSWORD=
DEMO_ENABLED=true
STORAGE_ROOT=F:/Deepseekworkplace/research-material-system/backend/data/uploads
AUTH_SECRET=research-material-local-secret-change-in-production
DISPLAY_ACCESS_KEY=research-display-2026
```

> `server.tomcat.basedir` 和 `java.io.tmpdir` 是为了避开 Windows 临时目录权限问题，建议保留。

### 5.3 验证后端

浏览器打开：

```text
http://localhost:8080/api/health
```

返回：

```json
{"code":0,"message":"ok","data":{"status":"UP"}}
```

后端日志出现 `Started ResearchMaterialApplication` 即启动成功。

## 6. 启动前端

### 6.1 推荐：IDEA Terminal

```powershell
cd F:\Deepseekworkplace\research-material-system
.\scripts\start-frontend.cmd
```

首次会自动安装依赖，之后直接启动 Vite。

看到：

```text
VITE ready
Local: http://localhost:5173/
```

打开浏览器：

```text
http://localhost:5173
```

### 6.2 如果使用 `Frontend Dev` 运行配置

`Frontend Dev` 使用 `frontend/package.json` 的 `dev` 脚本，需要在 IDEA 中配置 Node interpreter。

如果提示 `npm not found`，说明当前 Node 没有 npm，改用上面的 `start-frontend.cmd`。

### 6.3 前端代理

`frontend/vite.config.js` 中：

```js
proxy: {
  '/api': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true
  }
}
```

如果后端改了端口，例如 8081，要同步改成 `http://127.0.0.1:8081`，然后重启前端。

## 7. 一键启动全部服务

### 方式 A：项目脚本

在 IDEA Terminal 或文件资源管理器中执行：

```powershell
cd F:\Deepseekworkplace\research-material-system
.\scripts\start-all.cmd
```

它会：

1. 启动 MySQL
2. 打开后端命令行窗口
3. 打开前端命令行窗口
4. 自动打开浏览器

关闭对应的命令行窗口即可停止后端/前端。

### 方式 B：IDEA 运行配置

1. 先启动 MySQL（`start-mysql.cmd`）
2. 选择 `Backend + Frontend` 复合配置
3. 点击运行

如果 `Frontend Dev` 因 Node/npm 不可用，使用方式 A。

### 方式 C：三个终端

```powershell
# 终端 1
.\scripts\start-mysql.cmd

# 终端 2
.\scripts\start-backend.cmd

# 终端 3
.\scripts\start-frontend.cmd
```

## 8. 后端配置怎么改

### 8.1 配置文件

| 文件 | 作用 |
| --- | --- |
| `backend/src/main/resources/application.yml` | 公共配置、环境变量占位符 |
| `backend/src/main/resources/application-local.yml` | 本地环境：3307 端口、演示数据开关 |
| `frontend/vite.config.js` | 前端端口和 `/api` 代理地址 |

### 8.2 配置优先级

从高到低：

```text
命令行参数（Program arguments）
> 环境变量（Environment variables）
> application-local.yml
> application.yml
```

例如：

```text
--server.port=8081
```

会覆盖 `application.yml` 中的 `server.port: ${SERVER_PORT:8080}`。

### 8.3 常见修改

#### 改数据库地址

在 IDEA 运行配置的 Environment variables 中改：

```text
DB_HOST=192.168.1.50
DB_PORT=3306
DB_NAME=research_material
DB_USERNAME=research
DB_PASSWORD=your-password
```

`application-local.yml` 已使用 `${DB_HOST:127.0.0.1}`，所以 local profile 也支持远程数据库。

#### 改后端端口

Program arguments 加：

```text
--server.port=8081
```

同时修改 `frontend/vite.config.js` 的 proxy target。

#### 改附件存储目录

Environment variables：

```text
STORAGE_ROOT=D:/research-material/uploads
```

目录需要可写。

#### 改大屏访问码

```text
DISPLAY_ACCESS_KEY=your-display-key
```

修改后重启后端，大屏使用：

```text
http://localhost:5173/display?key=your-display-key
```

#### 关闭演示数据

```text
DEMO_ENABLED=false
```

演示数据只在 `DEMO_ENABLED=true` 且项目表为空时生成；已有项目时不会重复生成。

#### 改 Token 密钥/有效期

```text
AUTH_SECRET=至少32位随机字符串
AUTH_EXPIRE_HOURS=12
```

生产必须修改 `AUTH_SECRET`。

#### 改季度截止天数/提醒天数

```text
QUARTERLY_DUE_DAYS=15
ALERT_UPCOMING_DAYS=30
```

### 8.4 修改后的生效方式

- 修改 Java 代码：IDEA `Build → Build Project`，重新运行 `Backend Local`。
- 修改 `application*.yml`：IDEA 会自动复制 resources，重新运行即可；如未生效，执行 `Build → Rebuild Project`。
- 修改 `pom.xml`：右键 `pom.xml → Maven → Reload Project`。
- 修改 `vite.config.js`：重启前端。
- 修改 `db/schema.sql`：不要在运行中的生产库直接执行；本地重置用 `init-db.cmd`。

## 9. 停止服务与端口冲突

查看端口：

```powershell
Get-NetTCPConnection -LocalPort 3307,8080,5173 | Select-Object LocalPort,OwningProcess
```

停止占用进程：

```powershell
Stop-Process -Id <PID>
```

停止 MySQL：

```powershell
& "F:\Deepseekworkplace\tools\mysql-8.0.29-winx64\bin\mysqladmin.exe" `
  --host=127.0.0.1 --port=3307 --user=root shutdown
```

如果启动后端时提示 `Port 8080 was already in use`，说明之前用脚本启动的后端还没停。关闭对应命令行窗口，或按 PID 停止。

## 10. 常见问题

### 10.1 IDEA 运行配置显示红色模块

`Run → Edit Configurations → Backend Local → Module` 重新选择 `research-material-backend`。

### 10.2 后端启动报数据库连接失败

1. 确认 MySQL 3307 已启动。
2. 确认 `DB_PORT=3307`。
3. 用 IDEA Database 工具测试连接。
4. 确认 `research_material` 库已初始化。

### 10.3 前端打开空白或接口 404

1. 确认后端 8080 正常：`/api/health`。
2. 确认 Vite proxy target 是 8080。
3. 确认浏览器访问的是 `http://localhost:5173`，不是直接打开 `index.html`。

### 10.4 `npm not found`

当前 Node 包没有 npm，使用：

```powershell
.\scripts\start-frontend.cmd
```

或在标准 Node.js 20+ 环境中配置 npm。

### 10.5 登录提示账号密码错误

确认执行过 `init-db.cmd`，默认账号是：

```text
admin / Admin@123
```

### 10.6 Windows 临时目录权限错误

确保后端运行配置中包含：

```text
-Djava.io.tmpdir=F:/Deepseekworkplace/research-material-system/backend/tmp
--server.tomcat.basedir=F:/Deepseekworkplace/research-material-system/backend/data/tomcat
```

## 11. 推荐日常启动顺序

```text
1. start-mysql.cmd
2. IDEA: Backend Local
3. IDEA Terminal: start-frontend.cmd
4. 浏览器打开 http://localhost:5173
5. 需要大屏时打开 /display?key=research-display-2026
```

这样 MySQL、后端、前端各自独立，排错最清晰。
