import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

// fetch() natif de Node (undici) n'honore pas HTTPS_PROXY/https_proxy par défaut,
// contrairement à curl ou à la plupart des clients HTTP. Utile derrière un proxy
// sortant d'entreprise — importé une fois au démarrage, avant tout appel fetch().
//
// EnvHttpProxyAgent (plutôt qu'un ProxyAgent construit à la main) respecte aussi
// NO_PROXY/no_proxy : indispensable pour les webhooks, qui peuvent pointer vers un
// hôte interne/local que le proxy sortant ne doit pas voir passer.
if (process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
