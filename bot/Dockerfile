FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos el contenido a una subcarpeta 'bot' para que las importaciones relativas funcionen
COPY . ./bot/

# El bot se ejecuta como modulo
CMD ["python", "-m", "bot.main"]
