package frc.robot.subsystems.arm;

import com.stzteam.features.marsprocessor.Fallback;
import com.stzteam.mars.models.singlemodule.Data;
import com.stzteam.mars.models.singlemodule.IO;

@Fallback
public interface ArmIO extends IO<ArmIO.ArmInputs> {

  public static class ArmInputs extends Data<ArmInputs> {

    public double position = 0;

    public boolean atLimit = false;
  }

  public void applyOutput(double volts);
}
