// @ts-check

/** @param {string} id @param {() => void} render */
export function createOperationPage(id, render) {
  let mounted = false;
  return {
    id,
    mount() {
      mounted = true;
    },
    unmount() {
      mounted = false;
    },
    render() {
      if (!mounted) this.mount();
      render();
    }
  };
}
