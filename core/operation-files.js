// @ts-check

/**
 * @param {{
 *   isReady: () => boolean,
 *   readLegacy: (id: string) => Promise<File | undefined>,
 *   upload: (id: string, file: File) => Promise<unknown>,
 *   download: (id: string) => Promise<File | undefined>,
 *   remove: (id: string) => Promise<unknown>
 * }} adapters
 */
export function createOperationFiles(adapters) {
  return {
    /** @param {string} id @param {File} file */
    upload(id, file) {
      if (!adapters.isReady()) return Promise.reject(new Error('A operação ainda não foi carregada.'));
      return adapters.upload(id, file);
    },
    /** @param {string} id */
    download(id) {
      return adapters.isReady() ? adapters.download(id) : adapters.readLegacy(id);
    },
    /** @param {string} id */
    remove(id) {
      if (!adapters.isReady()) return Promise.reject(new Error('A operação ainda não foi migrada.'));
      return adapters.remove(id);
    }
  };
}
