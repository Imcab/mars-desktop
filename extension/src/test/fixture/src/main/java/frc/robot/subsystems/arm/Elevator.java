package frc.robot.subsystems.arm;

import com.stzteam.mars.models.SubsystemBuilder;
import com.stzteam.mars.models.singlemodule.ModularSubsystem;

/**
 * Left exactly as the subsystem wizard generates it, and never wired into the
 * container. Two diagnostics have to fire on this class: the null key and the
 * orphan.
 */
public class Elevator extends ModularSubsystem<ArmInputs, ArmIO> {

  public Elevator(ArmIO io) {
    super(
        SubsystemBuilder.<ArmInputs, ArmIO>setup()
            .key(null) // TODO -> KeyManager.ELEVATOR_KEY
            .hardware(io, new ArmInputs()));
  }

  @Override
  public void absolutePeriodic(ArmInputs inputs) {}
}
