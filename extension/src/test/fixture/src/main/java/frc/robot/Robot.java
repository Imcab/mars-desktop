// Copyright (c) FIRST and other WPILib contributors.
// Open Source Software; you can modify and/or share it under the terms of
// the WPILib BSD license file in the root directory of this project.

package frc.robot;

import com.stzteam.forgemini.io.NetworkIO;
import com.stzteam.mars.builder.Environment;
import com.stzteam.mars.models.containers.IRobotContainer;

import edu.wpi.first.wpilibj.RobotBase;
import edu.wpi.first.wpilibj.TimedRobot;
import edu.wpi.first.wpilibj2.command.CommandScheduler;
import frc.robot.configuration.Manifest;

public class Robot extends TimedRobot {

  private final IRobotContainer m_robotContainer;

  public Robot() {
    Environment.setMode(Manifest.CURRENT_MODE);
    m_robotContainer = new RobotContainer();

    // Published outside any subsystem, which is what makes these the project's
    // "other topics" and the reason the live subscription has to cover /System/
    // as well as the subsystem tables.
    NetworkIO.set("System", "IO", Environment.getMode().name());
    NetworkIO.set("System", "isOnSim", RobotBase.isSimulation());
  }

  @Override
  public void robotPeriodic() {
    CommandScheduler.getInstance().run();
    m_robotContainer.updateNodes();
  }
}
