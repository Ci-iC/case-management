// Electron 主进程（CommonJS，兼容 "type":"module" 的项目）
const { app, BrowserWindow, shell } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'GlobalX 法律事务管理系统',
    // 如需自定义图标，取消下行注释并放置 build/icon.ico
    // icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 隐藏默认菜单栏
  win.setMenuBarVisibility(false)

  // 加载 Vite 构建产物
  win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))

  // 外部链接在浏览器中打开，不在 Electron 窗口内跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(createWindow)

// 关闭所有窗口时退出（Windows / Linux 行为）
app.on('window-all-closed', () => {
  app.quit()
})
