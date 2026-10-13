# Third-party components

This is an independent adapter, not an official REA or OpenAI release.

- [REA / rea-agents](https://github.com/morluto/rea), morluto and contributors:
  MIT. The pinned npm dependency supplies the REA implementation, its bundled
  skill and licenses. The installer copies its original skill and references
  only if the user's skill is absent, and retains its license in that folder.
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk):
  Apache-2.0. Used as pinned npm dependencies.
- [Zod](https://github.com/colinhacks/zod): MIT.
- [smol-toml](https://github.com/squirrelchat/smol-toml): MIT.

Other transitive dependencies retain their respective licenses in
`node_modules`. This adapter grants no license for external analysis engines
such as Hopper, IDA or JEB. Existing engine and target authorization requirements
still apply.
