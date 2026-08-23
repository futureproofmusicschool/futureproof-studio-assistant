import http from "node:http";

/**
 * A timeout means something accepted the connection but did not answer in
 * time. Treat that port as occupied; only an explicit refusal proves it is
 * safe to start another server.
 */
export function probeServer({ port, timeoutMs = 1500 }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const request = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        response.on("end", () => {
          try {
            const marker = JSON.parse(body);
            finish(
              response.statusCode === 200 &&
                marker?.app === "futureproof-studio-assistant" &&
                marker?.protocol === 1
                ? "studio"
                : "occupied",
            );
          } catch {
            finish("occupied");
          }
        });
      },
    );

    request.on("error", (error) => {
      finish(error?.code === "ECONNREFUSED" ? "empty" : "occupied");
    });
    request.on("timeout", () => {
      finish("occupied");
      request.destroy();
    });
  });
}
