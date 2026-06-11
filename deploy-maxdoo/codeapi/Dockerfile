FROM python:3.12-slim

RUN useradd --uid 10001 --create-home sandbox \
    && mkdir -p /data/sessions /mnt /tmp/mplconfig \
    && chown -R sandbox:sandbox /data /mnt /tmp/mplconfig

COPY requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt

COPY app.py /srv/app.py

USER sandbox
WORKDIR /srv
EXPOSE 8700

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8700"]
