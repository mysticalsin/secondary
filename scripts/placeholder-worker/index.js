// Placeholder uploaded by scripts/deploy.sh so a service binding has a target while two workers
// bind each other (api <-> connector). It answers 503 and is replaced by the real deploy that follows.
export default {
  fetch() {
    return new Response("placeholder", { status: 503 });
  },
};
