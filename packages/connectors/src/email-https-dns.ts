import { request as httpRequest } from "node:http";
import { Agent, request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import type { Socket } from "node:net";

export function validDnsProxy(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && Boolean(url.port) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

/** Only public DNS queries use this tunnel. No SMTP or account credentials. */
export function resolveSmtpHttps(host: string, proxy: string): Promise<string[]> {
  if (!validDnsProxy(proxy) || !/^[a-z0-9.-]+$/i.test(host)) return Promise.reject(new Error("SMTP DNS unavailable"));
  const url = new URL(proxy);
  return new Promise((resolve, reject) => {
    let settled = false; let socket: Socket | undefined; let agent: Agent | undefined;
    const finish = (addresses?: string[]) => {
      if (settled) return; settled = true; clearTimeout(timer); tunnel.destroy(); agent?.destroy(); socket?.destroy();
      if (addresses?.length) resolve(addresses); else reject(new Error("SMTP DNS unavailable"));
    };
    const tunnel = httpRequest({ hostname: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port), method: "CONNECT", path: "dns.google:443", headers: { Host: "dns.google:443" } });
    const timer = setTimeout(() => finish(), 7_000);
    tunnel.on("error", () => finish()); tunnel.on("response", () => finish());
    tunnel.on("connect", (response, connection, head) => {
      socket = connection;
      if (response.statusCode !== 200 || head.length) { finish(); return; }
      const secure = tlsConnect({ socket: connection, servername: "dns.google", rejectUnauthorized: true, minVersion: "TLSv1.2" }); socket = secure;
      secure.on("error", () => finish());
      secure.once("secureConnect", () => {
        agent = new Agent(); agent.createConnection = () => secure;
        const request = httpsRequest({ hostname: "dns.google", method: "GET", path: `/resolve?name=${encodeURIComponent(host)}&type=A`, agent, headers: { Accept: "application/dns-json" } }, response => {
          if (response.statusCode !== 200) { response.destroy(); finish(); return; }
          const chunks: Buffer[] = []; let size = 0;
          response.on("error", () => finish());
          response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 65_536) { response.destroy(); finish(); } else chunks.push(chunk); });
          response.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
              finish(data.Status === 0 && Array.isArray(data.Answer) ? data.Answer.filter(row => row.type === 1 && typeof row.data === "string").map(row => row.data!).slice(0, 8) : undefined);
            } catch { finish(); }
          });
        });
        request.on("error", () => finish()); request.end();
      });
    });
    tunnel.end();
  });
}
