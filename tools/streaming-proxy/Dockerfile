# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
FROM python:3.12-alpine@sha256:eb96e2791a0e8f4d79689719129cc6c6c9d2b48d83be3aabe1cef6856a3d0b29

WORKDIR /app

RUN apk add --no-cache curl

RUN pip install --no-cache-dir fastapi==0.115.6 httpx==0.28.1 uvicorn==0.34.0

COPY proxy.py .

EXPOSE 9000

CMD ["uvicorn", "proxy:app", "--host", "0.0.0.0", "--port", "9000"]
