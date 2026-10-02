FROM python:3.12-slim
WORKDIR /app/tools/ai-context
COPY tools/ai-context/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 10001 --create-home context \
    && mkdir -p /state/oauth && chown -R context:context /state
COPY tools/ai-context/build.py tools/ai-context/context_store.py tools/ai-context/server.py ./
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "server.py"]
