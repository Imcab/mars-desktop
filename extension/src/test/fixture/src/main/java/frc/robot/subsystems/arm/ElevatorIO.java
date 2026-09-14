package frc.robot.subsystems.arm;

import com.stzteam.features.marsprocessor.Fallback;
import com.stzteam.mars.models.singlemodule.Data;
import com.stzteam.mars.models.singlemodule.IO;

/**
 * Half-built on purpose: declared, annotated, and with nothing behind it. The
 * unimplemented-IO diagnostic and its quick fix both need an interface in this
 * state to have anything to say.
 */
@Fallback
public interface ElevatorIO extends IO<ElevatorIO.ElevatorInputs> {

  public static class ElevatorInputs extends Data<ElevatorInputs> {

    public double height = 0;
  }

  public void applyOutput(double volts);

  public boolean isHomed();
}
