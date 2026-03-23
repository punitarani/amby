FROM mcr.microsoft.com/devcontainers/python:3.14

ARG DEBIAN_FRONTEND=noninteractive

# ─── System packages ───────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
	# Core tools
	curl wget git ca-certificates gnupg sudo \
	# Build essentials
	build-essential pkg-config \
	# Networking / utilities
	openssh-client jq unzip zip htop less nano ripgrep \
	iputils-ping bind9-dnsutils \
	sqlite3 poppler-utils file \
	# Browser
	chromium \
	# X11 libraries (required for computer-use / screen interaction)
	libx11-6 libxrandr2 libxext6 libxrender1 libxfixes3 \
	libxss1 libxtst6 libxi6 \
	# XCB libraries (screen capture)
	libxcb1 libxcb-shm0 libxcb-shape0 libxcb-xfixes0 \
	# Screen recording
	ffmpeg \
	# VNC and desktop environment
	xvfb x11vnc novnc \
	xfce4 xfce4-terminal dbus-x11 \
	# Locale
	locales \
	&& locale-gen en_US.UTF-8 \
	&& rm -rf /var/lib/apt/lists/*

# ─── Node.js 22 ────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
	&& apt-get install -y --no-install-recommends nodejs \
	&& rm -rf /var/lib/apt/lists/*

# ─── Python requirements ───────────────────────────────────
COPY requirements.txt /tmp/requirements.txt

# ─── Global Node tools ────────────────────────────────────
RUN npm install -g typescript@5 ts-node typescript-language-server bun@1.3

# ─── Python tooling & packages ────────────────────────────
RUN python3 -m pip install --no-cache-dir pipx==1.8.0 \
	&& PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install uv==0.9.26 \
	&& uv pip install --system --break-system-packages --no-cache --only-binary=:all: -r /tmp/requirements.txt \
	&& rm -f /tmp/requirements.txt

# ─── Users & permissions ──────────────────────────────────
# user — default human user (VNC sessions, browser, limited access)
#   Access: home, tmp, Downloads, Documents, Desktop
RUN useradd -m -s /bin/bash -d /home/user user \
	&& mkdir -p /home/user/Downloads /home/user/Documents /home/user/Desktop \
	&& chown -R user:user /home/user

# agent — tool-calling user for the AI agent
#   Access: everything user has + Desktop/Documents/Downloads, /opt/amby
#   Can sudo as user (for browser/GUI tasks) and install packages as root
RUN useradd -m -s /bin/bash -d /home/agent agent \
	&& mkdir -p /home/agent /home/agent/.persist /home/agent/.local/bin \
	&& ln -sfn /home/agent/.persist/Desktop /home/agent/Desktop \
	&& ln -sfn /home/agent/.persist/Documents /home/agent/Documents \
	&& ln -sfn /home/agent/.persist/Downloads /home/agent/Downloads \
	&& ln -sfn /home/agent/.persist/.codex /home/agent/.codex \
	&& ln -sfn /home/agent/.persist/.tasks /home/agent/.tasks \
	&& chown -R agent:agent /home/agent

# agent can read user's home (not write)
RUN chmod 755 /home/user

# agent sudo rules — can act as user, and install packages as root
RUN echo "agent ALL=(user) NOPASSWD: ALL" >> /etc/sudoers.d/agent \
	&& echo "agent ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/dpkg, /usr/bin/npm, /usr/local/bin/npm" >> /etc/sudoers.d/agent \
	&& chmod 0440 /etc/sudoers.d/agent

# Shared tmp
RUN chmod 1777 /tmp

# ─── Agent workspace ──────────────────────────────────────
RUN mkdir -p /opt/amby && chown agent:agent /opt/amby

# ─── Environment ──────────────────────────────────────────
ENV LANG=en_US.UTF-8 \
	LC_ALL=en_US.UTF-8 \
	DISPLAY=:1 \
	HOME=/home/agent \
	PATH="/home/agent/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"

WORKDIR /home/agent

USER agent

# Suppress shell setup prompts
RUN touch ~/.bashrc ~/.zshrc

ENTRYPOINT ["sleep", "infinity"]
