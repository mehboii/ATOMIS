import { mesh, GhostChannel } from "ghostnet/core"
let activeNodes: Node[] = []
const __node_01 = new GhostNode({
  id: "node-01",
  type: "esp32",
  transport: ["bluetooth", "tcp"],
  encrypt: "aes256"
})
const __ghostchat = new GhostChannel({
  id: "ghostchat",
  peers: ["node-01"],
  e2e: true,
  persist: false
})
__ghostchat.connect(__node_01, "bluetooth")
__atomis_cell("scan", async () => {
  activeNodes = await mesh.scan()
  console.log(`Found ${activeNodes.length} peers`)
})
function sendMsg(text: string): void {
  if (!(text.length > 0)) { return }
  channel.send("ghostchat", text)
}
//# sourceMappingURL=network.ts.ato.map
