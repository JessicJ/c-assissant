import { Resolver } from "node:dns/promises";
import { createConnection, isIPv4, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { resolveSmtpHttps, validDnsProxy } from "./email-https-dns.js";

export interface DirectSmtpConfiguration { interfaceName: string; dnsServers: string[]; dnsHttpsProxy?: string }
type Dependencies = {
  localAddress(name: string): string | undefined;
  resolve(host: string, localAddress: string, servers: string[]): Promise<string[]>;
  connect(options: { host: string; port: number; localAddress: string; family: 4 }): Socket;
};
const defaults: Dependencies = {
  localAddress: name => networkInterfaces()[name]?.find(row => row.family === "IPv4" && !row.internal)?.address,
  resolve: async (host, localAddress, servers) => {
    const resolver = new Resolver({ timeout: 2_000, tries: 1 });
    resolver.setLocalAddress(localAddress); resolver.setServers(servers);
    return resolver.resolve4(host);
  },
  connect: options => createConnection(options)
};
const failure = () => Object.assign(new Error("SMTP direct connection unavailable"), { code: "ECONNECTION", command: "CONN" });

/** Only opens TCP. Nodemailer retains the original hostname and performs TLS/AUTH. */
export async function openDirectSmtpConnection(host: string, port: number, config: DirectSmtpConfiguration, dependencies: Dependencies = defaults): Promise<Socket> {
  if (!config.interfaceName || !/^[a-zA-Z0-9_.:-]{1,64}$/.test(config.interfaceName) || (config.dnsHttpsProxy ? !validDnsProxy(config.dnsHttpsProxy) : !config.dnsServers.length || config.dnsServers.length > 4 || !config.dnsServers.every(isIPv4))) throw failure();
  const localAddress = dependencies.localAddress(config.interfaceName);
  if (!localAddress || !isIPv4(localAddress)) throw failure();
  let active: Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; active?.destroy(); reject(failure()); }, 10_000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const addresses = config.dnsHttpsProxy ? await resolveSmtpHttps(host, config.dnsHttpsProxy) : await dependencies.resolve(host, localAddress, config.dnsServers);
      // 198.18.0.0/15 is commonly synthesized by proxy DNS; never dial it here.
      const address = addresses.find(value => isIPv4(value) && !/^198\.(18|19)\./.test(value));
      if (expired || !address) throw failure();
      return await new Promise<Socket>((resolve, reject) => {
        const socket = dependencies.connect({ host: address, port, localAddress, family: 4 }); active = socket;
        const onError = () => { socket.removeListener("connect", onConnect); socket.destroy(); reject(failure()); };
        const onConnect = () => { socket.removeListener("error", onError); resolve(socket); };
        socket.once("error", onError); socket.once("connect", onConnect);
      });
    })()]);
  } catch { active?.destroy(); throw failure(); }
  finally { if (timer) clearTimeout(timer); }
}
