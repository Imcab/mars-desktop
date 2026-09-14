package frc.robot.configuration;

import com.stzteam.mars.builder.Environment;
import com.stzteam.mars.builder.Environment.RunMode;

public class Manifest {

    // Pinned to SIM on purpose: the run mode diagnostic has to have something
    // to report, and this is the mistake it exists to catch.
    public static final RunMode CURRENT_MODE = RunMode.SIM;

    public static final boolean HAS_ARM = true;

    static { Environment.setMode(CURRENT_MODE); }
}
