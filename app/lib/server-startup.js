const { once } = require("node:events");

/**
 * Reserve the public port before Next prepares its development output.
 *
 * Next clears and rebuilds `.next` during prepare. If two processes prepare
 * concurrently, the process that eventually loses the port race can still
 * invalidate the running process's bundles. Binding first makes that race
 * impossible: only the port owner is allowed to prepare.
 */
async function claimServerBeforePreparing(server, options) {
  const { port, host, prepare } = options;

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  try {
    return await prepare();
  } catch (error) {
    server.close();
    await once(server, "close").catch(() => {});
    throw error;
  }
}

module.exports = { claimServerBeforePreparing };
