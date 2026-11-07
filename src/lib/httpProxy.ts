import { ProxyAgent, setGlobalDispatcher } from "undici";

// fetch() natif de Node (undici) n'honore pas HTTPS_PROXY/https_proxy par défaut,
// contrairement à curl ou à la plupart des clients HTTP. Utile derrière un proxy
// sortant d'entreprise — importé une fois au démarrage, avant tout appel fetch().
const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}
