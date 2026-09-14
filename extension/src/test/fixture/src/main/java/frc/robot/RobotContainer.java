package frc.robot;

import com.stzteam.mars.models.containers.IRobotContainer;
import com.stzteam.mars.test.TestRoutine;

import frc.robot.subsystems.arm.Arm;
import frc.robot.subsystems.arm.ArmIOReal;

public class RobotContainer implements IRobotContainer {

  private final Arm arm = new Arm(new ArmIOReal());

  @Override
  public void updateNodes() {}

  @Override
  public TestRoutine getTestRoutine() { return null; }
}
