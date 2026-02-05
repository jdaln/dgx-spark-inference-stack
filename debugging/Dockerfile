FROM python:3.12-alpine

WORKDIR /app

RUN apk add --no-cache curl

RUN pip install --no-cache-dir fastapi uvicorn httpx

COPY proxy.py .

EXPOSE 9000

CMD ["uvicorn", "proxy:app", "--host", "0.0.0.0", "--port", "9000"]
