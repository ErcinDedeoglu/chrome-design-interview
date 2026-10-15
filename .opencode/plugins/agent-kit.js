// First install requires --with-opencode-plugin; existing plugins refresh by default.
// OpenCode 2 does not run a V1 function export. This file exports id + setup.
// File presence is not activation. Re-run tooling/agent-kit/probe-plugin.sh.
// Commit gates do not depend on this file. See tooling/agent-kit/INSTALL.md.

const PLUGIN_ID = "agent-kit"

const KIT = new Set([
  "docs",
  "memory",
  "openspec",
  "tooling",
  ".github",
  ".git",
  ".opencode",
  ".claude",
  ".githooks",
  "node_modules",
  "dist",
  "build",
])

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"])

function norm(p) {
  return String(p || "").replace(/\\/g, "/")
}

function relTo(filePath, root) {
  if (!filePath) return null
  const r = norm(root).replace(/\/$/, "")
  let rel = norm(filePath)
  if (rel === r) return null
  if (rel.startsWith(r + "/")) rel = rel.slice(r.length + 1)
  if (rel.startsWith("/")) return null
  return rel
}

function submodulePaths(fs, path, root) {
  const gm = path.join(root, ".gitmodules")
  if (!fs.existsSync(gm)) return []
  const out = []
  for (const line of fs.readFileSync(gm, "utf8").split("\n")) {
    const m = line.match(/^\s*path\s*=\s*(.+?)\s*$/)
    if (m) out.push(norm(m[1]).replace(/\/$/, ""))
  }
  return out
}

function submoduleFor(rel, subs) {
  if (!rel) return null
  return subs.find((s) => rel === s || rel.startsWith(s + "/")) || null
}

function topDir(rel) {
  if (!rel || !rel.includes("/")) return null
  const top = rel.split("/")[0]
  if (KIT.has(top)) return null
  return top
}

function fileFrom(event) {
  const input = event?.input || event?.args || {}
  const args = input && typeof input.args === "object" && input.args ? input.args : input
  return args?.filePath || args?.path || args?.file_path || args?.file || null
}

async function loadNode() {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const { spawnSync } = await import("node:child_process")
  return { fs, path, spawnSync }
}

function canon(fs, p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

function resolveRel(fs, path, filePath, root) {
  if (!filePath) return null
  const rootReal = canon(fs, root)
  let abs = path.isAbsolute(filePath) ? filePath : path.resolve(rootReal, filePath)
  const parent = path.dirname(abs)
  let parentReal = parent
  try {
    parentReal = fs.realpathSync(parent)
  } catch {
    /* new file: parent may not exist yet */
  }
  abs = path.join(parentReal, path.basename(abs))
  return relTo(abs, rootReal)
}

function createGuards(node, directory) {
  const { fs, path, spawnSync } = node
  const root = canon(fs, directory)
  const checker = path.join(root, "tooling/agent-kit/check.sh")

  function runCheck() {
    if (!fs.existsSync(checker)) return { status: 0, text: "" }
    const r = spawnSync("bash", [checker, root], { encoding: "utf8", cwd: root })
    return { status: r.status ?? 1, text: `${r.stdout || ""}${r.stderr || ""}` }
  }

  function before(tool, file) {
    if (!WRITE_TOOLS.has(String(tool || "").toLowerCase())) return
    const rel = resolveRel(fs, path, file, root)
    if (!rel) return

    const sub = submoduleFor(rel, submodulePaths(fs, path, root))
    if (sub) {
      throw new Error(
        `agent-kit: blocked write to ${rel} — '${sub}/' is a git submodule (a foreign repository). ` +
          `Never edit or scaffold inside it. Instead: describe it in docs/submodules/, ` +
          `wrap it at the boundary in your own code, bump the pinned commit, or file the change upstream. ` +
          `Read docs/SUBMODULES.md. Responsible: repo-scaffold .opencode/plugins/agent-kit.js`,
      )
    }

    const top = topDir(rel)
    if (!top) return
    const chain = path.join(root, "tooling/agent-kit/agents-chain.py")
    if (!fs.existsSync(chain)) {
      throw new Error(
        `agent-kit: missing tooling/agent-kit/agents-chain.py — re-run repo-scaffold init. Refusing write under ${top}/.`,
      )
    }
    const env = { ...process.env }
    delete env.AGENT_KIT_CHAIN_TEST
    delete env.AGENT_KIT_CROWD_THRESHOLD
    delete env.AGENT_KIT_SKIP
    const r = spawnSync("python3", [chain, "--guard", rel, root], {
      encoding: "utf8",
      cwd: root,
      env,
    })
    if ((r.status ?? 1) !== 0) {
      throw new Error(
        `${r.stderr || ""}${r.stdout || ""}`.trim() ||
          `agent-kit: chain guard failed for ${rel}. Read docs/GROWTH.md.`,
      )
    }
  }

  function after(tool, event) {
    if (!WRITE_TOOLS.has(String(tool || "").toLowerCase())) return
    const { status, text } = runCheck()
    const marker = "======== AGENT KIT STEER ========"
    const idx = text.indexOf(marker)
    if (idx >= 0 && event && typeof event === "object") {
      const steer = text.slice(idx)
      const target = event.result && typeof event.result === "object" ? event.result : event
      if (typeof target.output === "string") target.output += `\n${steer}`
      else if (typeof event.result === "string") event.result += `\n${steer}`
      else if (target && typeof target === "object") target.output = steer
    }
    if (status !== 0) throw new Error(text || "agent-kit check failed")
  }

  return { before, after }
}

export default {
  id: PLUGIN_ID,
  async setup(ctx) {
    const directory = ctx?.location?.directory || ctx?.directory
    if (!directory) throw new Error("agent-kit: plugin context has no directory")
    if (!ctx.tool || typeof ctx.tool.hook !== "function") {
      throw new Error("agent-kit: this OpenCode has no ctx.tool.hook; write-time blocking is not registered")
    }
    const guards = createGuards(await loadNode(), directory)
    await ctx.tool.hook("execute.before", async (event) => {
      guards.before(event?.tool, fileFrom(event))
    })
    await ctx.tool.hook("execute.after", async (event) => {
      guards.after(event?.tool, event)
    })
  },
  // Older OpenCode calls server(). V2 ignores it. Not probed unless that binary is on PATH.
  async server({ directory } = {}) {
    if (!directory) throw new Error("agent-kit: V1 server() has no directory")
    const guards = createGuards(await loadNode(), directory)
    return {
      "tool.execute.before": async (input, output) => {
        const file =
          output?.args?.filePath || output?.args?.path || output?.args?.file_path || output?.args?.file
        guards.before(input?.tool, file)
      },
      "tool.execute.after": async (input, output) => {
        guards.after(input?.tool, { tool: input?.tool, status: "completed", result: output })
      },
    }
  },
}
