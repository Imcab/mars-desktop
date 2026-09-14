package frc.robot.subsystems.arm;

import com.stzteam.forgemini.io.NetworkIO;
import com.stzteam.mars.models.SubsystemBuilder;
import com.stzteam.mars.models.Telemetry;
import com.stzteam.mars.models.singlemodule.ModularSubsystem;

import frc.robot.configuration.KeyManager;
import frc.robot.subsystems.arm.ArmIO.ArmInputs;

public class Arm extends ModularSubsystem<ArmInputs, ArmIO> {

  @Tunable(key = "kP")
  public double gainP = 0.5;

  public Arm(ArmIO io) {
    super(
        SubsystemBuilder.<ArmInputs, ArmIO>setup()
            .key(KeyManager.ARM_KEY)
            .hardware(io, new ArmInputs())
            .request(null)
            .telemetry(new ArmTelemetry()));
  }

  @Override
  public void absolutePeriodic(ArmInputs inputs) {}

  public static class ArmTelemetry extends Telemetry<ArmInputs> {

    @Override
    public void telemeterize(ArmInputs data) {
      NetworkIO.set(KeyManager.ARM_KEY, "Position", data.position);
    }
  }
}
