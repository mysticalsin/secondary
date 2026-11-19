# Plan 008: Switch follow-up pins

Mount `switchGate` and then the same `/v1` paths the Worker registers: `aiRoutes`, `GET /sources/:id`, and `POST /personal/items/:id/contribute`. No catch-all.

## Security & data

The tests read the path and the switch map. They do not write stored data. No secret. No change to who may publish or download a Backlog folder.
