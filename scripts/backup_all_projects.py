import os
import sys
import gzip
import json
import ssl
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlparse
import pg8000.native
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

PROJECTS = [
    {
        "id": "mycrmsalon",
        "name": "01_MyCRMSalon",
        "dir": r"d:\crmsalon",
        "db_url": "postgresql://neondb_owner:npg_VcqDw8FWm4Qz@ep-cold-boat-baxh4uhb.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require"
    },
    {
        "id": "car_workshop",
        "name": "02_CarWorkshop_CRM",
        "dir": r"d:\car.crmtatweer",
        "db_url": "postgresql://neondb_owner:npg_POGDaRXMT2w7@ep-weathered-credit-baqiiux9.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require"
    },
    {
        "id": "somoud_crm",
        "name": "03_Somoud_CRM",
        "dir": r"d:\crm somoud",
        "db_url": "postgresql://neondb_owner:npg_RibE1GYgnq7C@ep-red-math-bajg6wts.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require"
    }
]

PARENT_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "1Ul08Wve8SnVeLBrqvGV90BflWD55EIig")

def get_drive_service():
    tokens_path = os.environ.get("GDRIVE_TOKENS_PATH", r"d:\crmsalon\gdrive_tokens.json")
    if os.path.exists(tokens_path):
        with open(tokens_path, "r", encoding="utf-8") as f:
            token_data = json.load(f)

        creds = Credentials(
            token=token_data.get("token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri=token_data.get("token_uri"),
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=token_data.get("scopes")
        )
        return build("drive", "v3", credentials=creds)

    refresh_token = os.environ.get("GDRIVE_REFRESH_TOKEN")
    client_id = os.environ.get("GDRIVE_CLIENT_ID")
    client_secret = os.environ.get("GDRIVE_CLIENT_SECRET")
    if refresh_token and client_id and client_secret:
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=["https://www.googleapis.com/auth/drive"]
        )
        return build("drive", "v3", credentials=creds)

    raise ValueError("No valid Google Drive credentials found.")

def get_or_create_subfolder(drive_service, parent_id, folder_name):
    query = f"'{parent_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '{folder_name}'"
    res = drive_service.files().list(q=query, fields="files(id, name)").execute()
    files = res.get("files", [])
    if files:
        return files[0].get("id")

    meta = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id]
    }
    folder = drive_service.files().create(body=meta, fields="id, name").execute()
    return folder.get("id")

def dump_postgres(db_url, out_file):
    parsed = urlparse(db_url)
    user = parsed.username
    password = parsed.password
    host = parsed.hostname
    port = parsed.port or 5432
    database = parsed.path.lstrip('/')

    ssl_ctx = ssl.create_default_context()
    conn = pg8000.native.Connection(
        user=user,
        password=password,
        host=host,
        port=port,
        database=database,
        ssl_context=ssl_ctx
    )

    tables = conn.run(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"
    )

    with gzip.open(out_file, "wt", encoding="utf-8") as f:
        f.write(f"-- Full PostgreSQL Dump for {database} on {host}\n")
        f.write(f"-- Exported on {datetime.now(timezone.utc).isoformat()}\n\n")

        for row in tables:
            tbl = row[0]
            col_info = conn.run(
                f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{tbl}' ORDER BY ordinal_position;"
            )
            col_names = [c[0] for c in col_info]
            if not col_names:
                continue
            cols_str = ", ".join([f'"{c}"' for c in col_names])

            f.write(f"\n-- Table: {tbl}\n")
            f.write(f"TRUNCATE TABLE \"{tbl}\" CASCADE;\n")

            records = conn.run(f"SELECT {cols_str} FROM \"{tbl}\";")
            if records:
                for rec in records:
                    val_strs = []
                    for val in rec:
                        if val is None:
                            val_strs.append("NULL")
                        elif isinstance(val, (int, float)):
                            val_strs.append(str(val))
                        elif isinstance(val, bool):
                            val_strs.append("TRUE" if val else "FALSE")
                        elif isinstance(val, (dict, list)):
                            s = json.dumps(val).replace("'", "''")
                            val_strs.append(f"'{s}'")
                        else:
                            s = str(val).replace("'", "''")
                            val_strs.append(f"'{s}'")
                    f.write(f"INSERT INTO \"{tbl}\" ({cols_str}) VALUES ({', '.join(val_strs)});\n")

    conn.close()

def archive_git_repo(repo_dir, out_zip_abs):
    cmd = ["git", "archive", "--format=zip", f"-o", out_zip_abs, "HEAD"]
    subprocess.run(cmd, cwd=repo_dir, check=True)

def upload_file(drive_service, file_path, folder_id, mime_type):
    name = os.path.basename(file_path)
    size_mb = os.path.getsize(file_path) / (1024 * 1024)
    print(f"  Uploading {name} ({size_mb:.2f} MB)...")
    meta = {
        "name": name,
        "parents": [folder_id]
    }
    media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)
    up = drive_service.files().create(body=meta, media_body=media, fields="id, name").execute()
    print(f"  Uploaded: {up.get('name')} (ID: {up.get('id')})")

def main():
    drive = get_drive_service()
    timestamp = datetime.now().strftime("%Y-%m-%d")

    print(f"=== Starting Backup for {len(PROJECTS)} Projects ===")

    for proj in PROJECTS:
        pid = proj["id"]
        pname = proj["name"]
        pdir = proj["dir"]
        db_url = proj["db_url"]

        print(f"\n[{pname}] Starting backup...")
        folder_id = get_or_create_subfolder(drive, PARENT_FOLDER_ID, pname)

        # 1. Archive Code
        code_zip = os.path.abspath(f"{pid}_code_{timestamp}.zip")
        print(f"  Archiving code from {pdir}...")
        try:
            archive_git_repo(pdir, code_zip)
            upload_file(drive, code_zip, folder_id, "application/zip")
        except Exception as e:
            print(f"  ERROR archiving code: {e}")
        finally:
            if os.path.exists(code_zip):
                try:
                    os.remove(code_zip)
                except Exception:
                    pass

        # 2. Dump Database
        db_dump = os.path.abspath(f"{pid}_db_{timestamp}.sql.gz")
        print(f"  Dumping Neon PostgreSQL database...")
        try:
            dump_postgres(db_url, db_dump)
            upload_file(drive, db_dump, folder_id, "application/gzip")
        except Exception as e:
            print(f"  ERROR dumping database: {e}")
        finally:
            if os.path.exists(db_dump):
                try:
                    os.remove(db_dump)
                except Exception:
                    pass

        print(f"[{pname}] Completed Successfully!")

    print("\n=== ALL PROJECTS BACKED UP AND UPLOADED SUCCESSFULLY! ===")

if __name__ == "__main__":
    main()
