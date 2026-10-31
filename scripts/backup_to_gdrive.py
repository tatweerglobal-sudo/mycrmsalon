import os
import sys
import json
from datetime import datetime, timezone, timedelta

def get_credentials():
    refresh_token = os.environ.get("GDRIVE_REFRESH_TOKEN")
    client_id = os.environ.get("GDRIVE_CLIENT_ID")
    client_secret = os.environ.get("GDRIVE_CLIENT_SECRET")

    if refresh_token and client_id and client_secret:
        print("Using OAuth 2.0 User Credentials for upload...")
        from google.oauth2.credentials import Credentials
        return Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=["https://www.googleapis.com/auth/drive"]
        )

    sa_key_json = os.environ.get("GDRIVE_SERVICE_ACCOUNT_KEY")
    if sa_key_json:
        print("Using Service Account Credentials for upload...")
        from google.oauth2 import service_account
        key_data = json.loads(sa_key_json)
        return service_account.Credentials.from_service_account_info(
            key_data,
            scopes=["https://www.googleapis.com/auth/drive"]
        )

    print("Error: No Google Drive credentials found (need GDRIVE_REFRESH_TOKEN or GDRIVE_SERVICE_ACCOUNT_KEY).")
    sys.exit(1)

def main():
    folder_id = os.environ.get("GDRIVE_FOLDER_ID")
    retention_days = int(os.environ.get("RETENTION_DAYS", "30"))

    # Support files from CLI args or BACKUP_FILE env
    files_to_upload = sys.argv[1:]
    if not files_to_upload:
        backup_file = os.environ.get("BACKUP_FILE")
        if backup_file:
            files_to_upload = [backup_file]

    if not files_to_upload:
        print("Error: No files specified to upload.")
        sys.exit(1)

    if not folder_id:
        print("Error: GDRIVE_FOLDER_ID environment variable is missing.")
        sys.exit(1)

    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        print("Error: google-api-python-client not installed.")
        sys.exit(1)

    creds = get_credentials()
    drive_service = build("drive", "v3", credentials=creds)

    for file_path in files_to_upload:
        if not os.path.exists(file_path):
            print(f"Warning: File not found, skipping: {file_path}")
            continue

        filename = os.path.basename(file_path)
        filesize = os.path.getsize(file_path)
        mime = "application/zip" if filename.endswith(".zip") else "application/gzip"

        print(f"Uploading {filename} ({filesize / (1024 * 1024):.2f} MB) to Google Drive folder: {folder_id}...")
        file_metadata = {
            "name": filename,
            "parents": [folder_id]
        }

        media = MediaFileUpload(file_path, mimetype=mime, resumable=True)
        uploaded = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id, name, size"
        ).execute()

        print(f"Successfully uploaded: {uploaded.get('name')} (ID: {uploaded.get('id')})")

    # Retention Policy: Clean up backups older than retention_days
    if retention_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        cutoff_iso = cutoff.isoformat()
        print(f"Checking for backups older than {retention_days} days (before {cutoff_iso})...")

        query = f"'{folder_id}' in parents and trashed = false and (name contains 'mycrmsalon_backup_' or name contains 'mycrmsalon_code_')"
        try:
            results = drive_service.files().list(
                q=query,
                fields="files(id, name, createdTime)",
                pageSize=100
            ).execute()

            files = results.get("files", [])
            for f in files:
                created_str = f.get("createdTime")
                if created_str:
                    created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                    if created_dt < cutoff:
                        print(f"Deleting expired backup: {f.get('name')} (ID: {f.get('id')})...")
                        drive_service.files().delete(fileId=f.get("id")).execute()
        except Exception as e:
            print(f"Warning: Failed to cleanup expired backups: {e}")

    print("All backup and upload tasks completed successfully.")

if __name__ == "__main__":
    main()
