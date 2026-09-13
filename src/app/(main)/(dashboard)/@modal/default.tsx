// Parallel route fallback — rendered whenever the current URL doesn't match
// an intercepted route inside @modal (i.e. almost always). Required by
// Next.js for any @slot without one: without this, a hard refresh or direct
// navigation to a page that never populated the slot 404s.
export default function ModalDefault() {
  return null;
}
