// 最小 Service Worker 占位
// 仅用于消除 SW 注册 404 控制台错误。
// 注意：本应用依赖「文件重命名 + 旧 URL 404」来绕开移动端 WebView 缓存，
// 因此此处【不监听 fetch、不缓存任何业务资源】，所有请求直连网络，
// 避免 SW 缓存层锁死旧版本导致更新不生效。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// 故意不注册 fetch 事件 -> 浏览器对所有请求走网络，不经过 SW 缓存。
