# MARS Feature Template

Welcome to the official **MARS Feature Template** by STZ-Robotics. 
This template provides everything you need to create, build, and publish your own modular extensions (Features) for the MARS FRC Framework.

## How to create your own MARS Feature

Follow these simple steps to start coding your custom node or utility:

### Step 1: Use this template
1. Click the green **"Use this template"** button at the top of this repository to create a new repository in your own GitHub account.
2. Clone your newly created repository to your local machine.

### Step 2: Configure your Feature Identification
Open the `MarsFeature.json` file in the root directory and update it with your team and feature information:
- `featureId`: The unique name of your feature (no spaces, e.g., `KrakenWrappers`).
- `name`: A human-readable name.
- `groupId`: Your team's package path (e.g., `com.team868.kraken`).

### Step 3: Write your Code
1. Navigate to `src/main/java/` and rename the example folder structure to match your `groupId`.
2. Write your code! You have full access to WPILib, ForgeMini, and the MARS Core automatically.
3. *Note: Do not modify or put code inside the `generated` folder. Gradle will automatically create your `FeatureConstants.java` there.*

### Step 4: Publish your Feature to the World!
This template includes an automated GitHub Actions workflow. You don't need to manually host anything.
1. Commit and push your changes to your `main` branch.
2. Go to your repository settings on GitHub: **Settings > Pages**.
3. Under "Build and deployment", set the Source to **Deploy from a branch**.
4. Select the **`gh-pages`** branch and the `/(root)` folder, then click **Save**.

Within a couple of minutes, your Feature will be live and ready to be installed into any MARS Robot Project!