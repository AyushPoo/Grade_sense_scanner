# Google Cloud Run Deployment Instructions

This guide provides the complete instructions to build, test, and deploy the new `backend-doctr` service to Google Cloud Run, and connect it to your mobile React Native app.

---

## 1. Running and Testing the Service Locally (Optional)

Before deploying to Google Cloud, you can test the `backend-doctr` service locally using Docker:

1. **Open a terminal** and navigate to the `backend-doctr` directory:
   ```bash
   cd F:\GradeSense\Scan\GradeSense-Scanner\backend-doctr
   ```

2. **Build the Docker container image**:
   ```bash
   docker build -t gradesense-doctr .
   ```
   *Note: This step downloads the DocTr and DocAligner model weights (~260MB total) directly into the image so they are cached and ready to run.*

3. **Run the container locally**:
   ```bash
   docker run -p 8080:8080 gradesense-doctr
   ```

4. **Verify it works** by querying the health endpoint in another terminal:
   ```bash
   curl http://localhost:8080/health
   ```
   You should receive:
   ```json
   {"status":"healthy","docaligner_loaded":true,"doctr_loaded":true}
   ```

---

## 2. Deploying to Google Cloud Run

Based on your Google Cloud Console screenshot, you have an active project named **GradeSense** and your existing services are in the **asia-southeast1** region. You can deploy the service using either of the following methods:

### Method A: Deploy via Google Cloud CLI (gcloud) - *easiest*

If you have the `gcloud` CLI installed on your machine and configured for your project:

1. Open your terminal at the root of the project:
   ```bash
   cd F:\GradeSense\Scan\GradeSense-Scanner
   ```

2. Deploy the `backend-doctr` sub-folder directly:
   ```bash
   gcloud run deploy gradesense-doctr-service --source ./backend-doctr --platform managed --region asia-southeast1 --allow-unauthenticated --memory 2Gi --cpu 2
   ```

   > [!IMPORTANT]
   > We configure the service with **2 GB of memory** (`--memory 2Gi`) and **2 CPUs** (`--cpu 2`) because both the `DocTr` dewarping model and the `DocAligner` corner detector run deep learning neural networks. They require this headroom to process images quickly and prevent Out-Of-Memory (OOM) crashes.

---

### Method B: Deploy via Google Cloud Console Web UI (GitHub Integration)

If you prefer to configure it visually in the browser:

1. **Push your code to GitHub**: Commit and push the project changes to your repository, ensuring the `backend-doctr/` directory is pushed.
2. Open your Google Cloud Run Console.
3. Click **Connect Repository** under the **Deploy a web service** section (as seen at the bottom-left of your console screenshot).
4. Select your connected GitHub account and select the repository `GradeSense-Scanner`.
5. Set up the build configuration:
   - **Branch**: Select your main/active branch (e.g., `main`).
   - **Build Type**: Select **Dockerfile**.
   - **Source Directory**: Enter `/backend-doctr` (this tells Cloud Build to build the container inside the `backend-doctr` sub-folder where the `Dockerfile` resides).
6. Configure the service settings:
   - **Service Name**: `gradesense-doctr-service`
   - **Region**: `asia-southeast1`
7. Click **Container, Connections, Security** (advanced settings):
   - **Memory**: Increase it to **2 GiB**.
   - **CPU**: Increase it to **2**.
8. Under **Authentication**, select **Allow unauthenticated invocations**.
9. Click **Create** to trigger the build and deploy.

---

## 3. Connecting the Service to the Mobile App

Once the deployment completes, Cloud Run will output your live URL (e.g., `https://gradesense-doctr-service-xxxx-as.a.run.app`).

1. Open `frontend/.env` (or create it if it doesn't exist).
2. Set the environment variable to your Cloud Run service URL:
   ```env
   EXPO_PUBLIC_DOCTR_URL="https://gradesense-doctr-service-xxxx-as.a.run.app"
   ```
3. Restart your Expo development server:
   ```bash
   npx expo start --clear
   ```

*Note: If the variable `EXPO_PUBLIC_DOCTR_URL` is omitted or the backend is offline, the mobile app automatically falls back to local on-device corner detection using `DocQuad` so scanning never breaks.*

---

## 4. Testing & Verification Guide

Once linked, verify the four scanner quality improvements:

1. **Rotation Bug Fix**: Capture a document sideways. The app should automatically orient the image upright (portrait) before saving.
2. **2-Page Split Fix**: Capture a double-page spread holding the phone in landscape. The scanner should split it down the vertical center into two separate vertical pages.
3. **Corner Detection**: Capture a sheet with curved corners. The cropped preview rectangle should align precisely with the sheet's edges (powered by backend `DocAligner`).
4. **Dewarping**: Check the final output of a curved page. The text lines should be flat and straight (powered by backend `DocTr`).
