FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY requirements.txt ./
RUN python3 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir -r requirements.txt

ENV PATH="/app/.venv/bin:$PATH"

COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
