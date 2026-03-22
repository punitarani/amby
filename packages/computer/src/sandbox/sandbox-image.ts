import { Image } from "@daytonaio/sdk"
import { AGENT_WORKDIR, DESKTOP_DIR, DOCUMENTS_DIR, DOWNLOADS_DIR } from "../config"

// TODO: Once Daytona plan supports snapshot push, switch to:
//   snapshot: "amby-computer:0.1.0"
// The Dockerfile at docker/computer/Dockerfile is the source of truth.
// Build & push with: bun run computer:build && bun run computer:push
export const sandboxImage = Image.base("ubuntu:24.04")
	.runCommands(
		"apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends " +
			"curl wget git ca-certificates gnupg sudo " +
			"build-essential pkg-config " +
			"python3 python3-pip python3-venv " +
			"openssh-client jq unzip zip htop less nano ripgrep " +
			"iputils-ping bind9-dnsutils " +
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
	.runCommands("npm install -g typescript@5 ts-node bun@1.3")
	.runCommands("python3 -m pip install --no-cache-dir --break-system-packages pipx uv")
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
		PATH: "/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin",
	})
	.workdir(AGENT_WORKDIR)
