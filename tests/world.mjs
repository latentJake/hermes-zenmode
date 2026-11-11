// A dummy world for scenario tests and demos: the same agents every run.
// `sevenAgents(ids, title)` → what the gateway would report for seven live sessions in a
// realistic mix, plus the status dots the app would paint and the events that happened.
export function sevenAgents(ids, title = id => id) {
  const now = Date.now() / 1000
  const [a, b, c, d, e, f, g] = ids
  const live = (id, n, status, ago, preview) => ({ id: 'ag-' + n, session_key: id, status, last_active: now - ago, title: title(id), preview, message_count: 6 + n, model: n % 2 ? 'claude-sonnet-5-5' : 'claude-opus-5-5' })
  return {
    ids: { failed: [a], needs: [b, c, d], working: [e, f], unread: [g] },
    live: [
      live(a, 1, 'idle', 900, ''),
      live(b, 2, 'waiting', 40, 'Ready to commit 4 files to main. Approve?'),
      live(c, 3, 'waiting', 180, 'Run `npm publish`? This is not reversible.'),
      live(d, 4, 'waiting', 420, 'Which of the two layouts should I keep?'),
      live(e, 5, 'working', 3, 'Running the test suite (212 of 480)…'),
      live(f, 6, 'working', 8, 'Reading 14 files under src/render…'),
      live(g, 7, 'idle', 600, '')
    ],
    dots: { [b]: 'needs-input', [c]: 'needs-input', [d]: 'needs-input', [e]: 'working', [f]: 'stalled', [g]: 'unread' },
    // what each waiting agent is blocked on, as the gateway reports open requests
    pending: {
      'ag-2': [{ id: 'srq-a', method: 'approval', params: { session_id: 'ag-2', request_id: 'apr-1', description: 'Commit 4 files to main', command: 'git commit -am "ship the stack" && git push origin main', choices: ['once', 'session', 'always', 'deny'] } }],
      'ag-3': [
        { id: 'srq-b', method: 'approval', params: { session_id: 'ag-3', request_id: 'apr-2', description: 'Publish the package. This is not reversible.', command: 'npm publish --access public', choices: ['once', 'deny'] } },
        { id: 'srq-b2', method: 'approval', params: { session_id: 'ag-3', request_id: 'apr-3', description: 'Tag the release', command: 'git tag v1.0.0', choices: ['once', 'deny'] } }
      ],
      'ag-4': [{ id: 'srq-c', method: 'clarify', params: { session_id: 'ag-4', questions: [{ qid: 'q1', question: 'Which of the two layouts should I keep?', choices: ['Stack on the left', 'Stack centred'], multi_select: false }] } }]
    },
    events: [{ type: 'message.complete', session_id: 'ag-1', payload: { status: 'error', error: 'Could not connect to the server (ECONNREFUSED 127.0.0.1:8080)' } }]
  }
}
