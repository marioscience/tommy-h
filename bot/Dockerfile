FROM python:3.11-alpine@sha256:6857d2dae63e052057f2db389a7061188ac9a92a3fa8d402bde68f36df6fada1

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.1 setuptools==83.0.0 wheel==0.46.2 \
    && python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip uninstall --yes setuptools wheel pip

# Copiamos el contenido a una subcarpeta 'bot' para que las importaciones relativas funcionen
COPY . ./bot/

RUN addgroup -S -g 10001 botuser \
    && adduser -S -D -H -u 10001 -G botuser botuser \
    && chown -R botuser:botuser /app
USER 10001:10001

# El bot se ejecuta como modulo
CMD ["python", "-m", "bot.main"]
