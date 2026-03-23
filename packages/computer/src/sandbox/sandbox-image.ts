import { resolve } from "node:path"
import { Image } from "@daytonaio/sdk"
import { AGENT_WORKDIR, DESKTOP_DIR, DOCUMENTS_DIR, DOWNLOADS_DIR } from "../config"

const COMPUTER_REQUIREMENTS_PATH = resolve(
	import.meta.dir,
	"../../../../docker/computer/requirements.txt",
)

// NOTE: sandboxImage is NOT used at runtime. Sandboxes are created from the
// pre-built Daytona snapshot (see COMPUTER_SNAPSHOT in config.ts).
// This object documents the image spec and serves as a fallback if snapshot is unavailable.
// Source of truth: docker/computer/Dockerfile
// Build & push: bun run computer:docker:build && bun run computer:docker:push
// Snapshot registration: bun run computer:snapshot:create
export const sandboxImage = Image.base("mcr.microsoft.com/devcontainers/python:3.14")
	.runCommands(
		"apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends " +
			"curl wget git ca-certificates gnupg sudo " +
			"build-essential pkg-config " +
			"openssh-client jq unzip zip htop less nano ripgrep " +
			"iputils-ping bind9-dnsutils sqlite3 poppler-utils file " +
			"chromium " +
			"libx11-6 libxrandr2 libxext6 libxrender1 libxfixes3 " +
			"libxss1 libxtst6 libxi6 " +
			"libxcb1 libxcb-shm0 libxcb-shape0 libxcb-xfixes0 " +
			"ffmpeg xvfb x11vnc novnc " +
			"xfce4 xfce4-terminal dbus-x11 " +
			"locales " +
			"&& locale-gen en_US.UTF-8 " +
			"&& rm -rf /var/lib/apt/lists/*",
	)
	.runCommands(
		"curl -fsSL https://deb.nodesource.com/setup_22.x | bash - " +
			"&& apt-get install -y --no-install-recommends nodejs " +
			"&& rm -rf /var/lib/apt/lists/*",
	)
	.addLocalFile(COMPUTER_REQUIREMENTS_PATH, "/tmp/requirements.txt")
	.runCommands("npm install -g typescript@5 ts-node typescript-language-server bun@1.3")
	.runCommands(
		"python3 -m pip install --no-cache-dir pipx==1.8.0 " +
			"&& PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install uv==0.9.26 " +
			"&& uv pip install --system --break-system-packages --no-cache --only-binary=:all: -r /tmp/requirements.txt " +
			"&& rm -f /tmp/requirements.txt",
	)
	.runCommands(
		"useradd -m -s /bin/bash -d /home/user user " +
			"&& mkdir -p /home/user/Downloads /home/user/Documents /home/user/Desktop " +
			"&& chown -R user:user /home/user",
	)
	.runCommands(
		"useradd -m -s /bin/bash -d /home/agent agent " +
			`&& mkdir -p ${DESKTOP_DIR} ${DOCUMENTS_DIR} ${DOWNLOADS_DIR} /home/agent/.local/bin ` +
			"&& chown -R agent:agent /home/agent",
	)
	.runCommands("chmod 755 /home/user")
	.runCommands(
		'echo "agent ALL=(user) NOPASSWD: ALL" >> /etc/sudoers.d/agent ' +
			'&& echo "agent ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/dpkg, /usr/bin/npm, /usr/local/bin/npm" >> /etc/sudoers.d/agent ' +
			"&& chmod 0440 /etc/sudoers.d/agent",
	)
	.runCommands("chmod 1777 /tmp " + "&& mkdir -p /opt/amby && chown agent:agent /opt/amby")
	.env({
		LANG: "en_US.UTF-8",
		LC_ALL: "en_US.UTF-8",
		DISPLAY: ":1",
		HOME: "/home/agent",
		PATH: "/home/agent/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
	})
	.workdir(AGENT_WORKDIR)
	.dockerfileCommands(["USER agent"])
	.entrypoint(["sleep", "infinity"])
