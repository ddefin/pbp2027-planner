# Runner GitHub Actions auto-hébergé, dans un conteneur Docker plutôt qu'installé
# directement sur DSM. DSM (Synology) manque d'outils que le runner .NET attend
# (ldd et d'autres bibliothèques), même quand les paquets semblent présents — faire
# tourner ça dans une vraie distro Linux en conteneur évite le problème entièrement.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates tar gnupg git jq sudo \
    && rm -rf /var/lib/apt/lists/*

# CLI Docker seul, pas de daemon ici : on parle au Docker du NAS via docker.sock monté
# en volume (voir docker-compose.yml) pour pouvoir lancer `docker compose` dessus.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Le conteneur tourne en root (nécessaire pour accéder à /var/run/docker.sock du NAS
# tel que monté, sans jongler avec le GID du groupe docker de l'hôte, qui varie d'un
# NAS à l'autre). Le runner GitHub refuse par défaut de s'exécuter en root — il faut
# le lui autoriser explicitement, sinon config.sh/run.sh échouent avec
# "Must not run with sudo" à chaque lancement.
ENV RUNNER_ALLOW_RUNASROOT=1

WORKDIR /home/runner

# Version résolue au build plutôt que figée en dur : évite de se retrouver avec un
# numéro de version obsolète codé dans ce Dockerfile.
RUN RUNNER_VERSION=$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/actions/runner/releases/latest | sed 's#.*/##') \
    && curl -fsSL -o actions-runner.tar.gz \
       "https://github.com/actions/runner/releases/download/${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION#v}.tar.gz" \
    && tar xzf actions-runner.tar.gz && rm actions-runner.tar.gz \
    && ./bin/installdependencies.sh

COPY entrypoint.sh /home/runner/entrypoint.sh
RUN chmod +x /home/runner/entrypoint.sh

ENTRYPOINT ["/home/runner/entrypoint.sh"]
