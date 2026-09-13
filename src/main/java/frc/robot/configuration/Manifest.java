package frc.robot.configuration;

import com.stzteam.mars.builder.Environment;
import com.stzteam.mars.builder.Environment.RunMode;

public class Manifest {

    public static final RunMode CURRENT_MODE = RunMode.REAL;

    static{Environment.setMode(CURRENT_MODE);}

}
