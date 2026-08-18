FROM python:3.11-slim@sha256:a630a63cdb314e2d138a2fca3e375e319e8568346ffafac5b980f888630ac4f1

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.1 setuptools==83.0.0 \
    && python -m pip install --no-cache-dir -r requirements.txt

# Copiamos el contenido a una subcarpeta 'bot' para que las importaciones relativas funcionen
COPY . ./bot/

RUN useradd --system --uid 10001 --no-create-home botuser \
    && chown -R botuser:botuser /app
USER 10001

# El bot se ejecuta como modulo
CMD ["python", "-m", "bot.main"]
