FROM python:3.12-alpine@sha256:eb96e2791a0e8f4d79689719129cc6c6c9d2b48d83be3aabe1cef6856a3d0b29

WORKDIR /app

RUN apk add --no-cache curl

RUN pip install --no-cache-dir fastapi httpx uvicorn

COPY proxy.py .

EXPOSE 9000

CMD ["uvicorn", "proxy:app", "--host", "0.0.0.0", "--port", "9000"]
