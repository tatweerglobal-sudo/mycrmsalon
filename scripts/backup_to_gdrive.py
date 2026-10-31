import os
import sys
import json
from datetime import datetime, timezone, timedelta

def main():
    backup_file = os.environ.get("BACKUP_FILE")
    sa_key_json = os.environ.get("GDRIVE_SERVICE_ACCOUNT_KEY")
    folder_id = os.environ.get("GDRIVE_FOLDER_ID")
    retention_days = int(os.environ.get("RETENTION_DAYS", "30"))

    if not backup_file or not os.path.exists(backup_file):
        print(f"Error: Backup file not found: {backup_file}")
        sys.exit(1)

    if not sa_key_json:
        print("Error: GDRIVE_SERVICE_ACCOUNT_KEY environment variable is missing.")
        sys.exit(1)

    if not folder_id:
        print("Error: GDRIVE_FOLDER_ID environment variable is missing.")
        sys.exit(1)

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        print("Error: google-api-python-client or google-auth not installed.")
        sys.exit(1)

    try:
        key_data = json.loads(sa_key_json)
    except Exception as e:
        print(f"Error parsing service account JSON key: {e}")
        sys.exit(1)

    creds = service_account.Credentials.from_service_account_info(
        key_data,
        scopes=["https://www.googleapis.com/auth/drive"]
    )

    drive_service = build("drive", "v3", credentials=creds)

    filename = os.path.basename(backup_file)
    filesize = os.path.getsize(backup_file)
    print(f"Uploading {filename} ({filesize / (1024 * 1024):.2f} MB) to Google Drive folder: {folder_id}...")

    file_metadata = {
        "name": filename,
        "parents": [folder_id]
    }

    media = MediaFileUpload(backup_file, mimetype="application/gzip", resumable=True)
    uploaded = drive_service.files().create(
        body=file_metadata,
        media_body=media,
        fields="id, name, size"
    ).execute()

    print(f"Successfully uploaded to Google Drive! File ID: {uploaded.get('id')}")

    # Retention Policy: Clean up backups older than retention_days
    if retention_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        cutoff_iso = cutoff.isoformat()
        print(f"Checking for backups older than {retention_days} days (before {cutoff_iso})...")

        query = f"'{folder_id}' in parents and trashed = false and name contains 'mycrmsalon_backup_'"
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

    print("Backup job completed successfully.")

if __name__ == "__main__":
    main()
